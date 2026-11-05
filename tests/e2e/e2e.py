"""End-to-end run of XS Gym as a real user, per platform, against the local stack
(real migrations + RLS on Postgres 16, PostgREST-equivalent API, Pages-like host).

    python3 e2e.py phone|tablet|laptop

Every step is timed; failures are recorded with a screenshot and the run goes on.
Ledger state is checked in Postgres after money actions."""
import json, os, re, subprocess, sys, time, csv, io
from playwright.sync_api import sync_playwright, expect

PLATFORM = sys.argv[1]
U = 'http://127.0.0.1:4300/xs-gym/'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('E2E_OUT', f'{HERE}/out') + f'/{PLATFORM}'
os.makedirs(OUT, exist_ok=True)
RUN = f'{PLATFORM}{int(time.time()) % 100000}'
EMAIL = f'qa.{RUN}@xsgym.test'
PASSWORD = 'Qa-pass-2026!'
DEMO_PASSWORD = os.environ.get('DEMO_PASSWORD', 'demo-password')
GYM = f'QA {PLATFORM.title()} Gym {RUN[-4:]}'

def sql(q, *a):
    r = subprocess.run(['psql', '-h', '127.0.0.1', '-p', '54330', '-U', 'postgres', '-X', '-At', '-F', '|', '-c', q], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return [l.split('|') for l in r.stdout.rstrip('\n').split('\n')] if r.stdout.strip('\n') != '' or r.stdout == '\n' else []

results, problems = [], []
def step(name):
    def wrap(fn):
        t = time.time()
        try:
            fn(); results.append((name, 'ok', time.time() - t, ''))
            print(f'ok    {name} ({time.time() - t:.1f}s)', flush=True)
        except Exception as e:
            lines = [l for l in str(e).split('\n') if l.strip()]
            msg = (lines[0][:240] + ' | ' + ' / '.join(l.strip()[:160] for l in lines[1:9])) if lines else repr(e)
            results.append((name, 'FAIL', time.time() - t, msg))
            print(f'FAIL  {name}: {msg}', flush=True)
            try: page.screenshot(path=f'{OUT}/FAIL-{re.sub(r"[^a-z0-9]+", "-", name.lower())}.png', full_page=True)
            except Exception: pass
        return fn
    return wrap
def note(kind, text):
    problems.append((kind, text)); print(f'NOTE  [{kind}] {text}', flush=True)

PROFILES = {
    'phone':  dict(viewport={'width': 393, 'height': 852}, device_scale_factor=3, is_mobile=True, has_touch=True,
                   user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    'tablet': dict(viewport={'width': 820, 'height': 1180}, device_scale_factor=2, is_mobile=True, has_touch=True,
                   user_agent='Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),
    'laptop': dict(viewport={'width': 1440, 'height': 900}, device_scale_factor=1),
}
touch = PROFILES[PLATFORM].get('has_touch', False)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(**PROFILES[PLATFORM], accept_downloads=True, timezone_id='Asia/Kolkata', locale='en-IN')
    page = ctx.new_page()
    console_errors, page_errors = [], []
    page.on('console', lambda m: console_errors.append(m.text) if m.type == 'error' and 'status of 404' not in m.text else None)
    page.on('pageerror', lambda e: page_errors.append(f'{str(e)} (during: {results[-1][0] if results else "start"} → next step)'))
    def tap(loc):
        loc.tap() if touch else loc.click()
    def toast(text, timeout=8000):
        expect(page.locator('.toasts')).to_contain_text(text, timeout=timeout)
    def dialog():
        return page.get_by_role('dialog')
    def go(path):
        page.goto(U + path); page.wait_for_load_state('networkidle')
    def nav(label):
        """Uses the platform's own navigation: tab bar / More sheet on phone, sidebar elsewhere."""
        if PLATFORM == 'phone':
            bar = page.locator('nav.tabbar')
            expect(bar.get_by_role('link')).to_have_count(4, timeout=8000)
            link = bar.get_by_role('link', name=label, exact=True)
            if link.count():
                tap(link)
            else:
                tap(bar.get_by_role('button', name='More'))
                tap(dialog().get_by_role('link', name=label))
        else:
            tap(page.locator('nav.sidebar').get_by_role('link', name=label, exact=True))
        page.wait_for_load_state('networkidle')
        # Wait for the section itself: its heading is shown and nothing is still loading.
        page.wait_for_function('() => !!document.querySelector("main h1") && !document.querySelector("main [aria-busy=true]")', timeout=10000)
        page.wait_for_timeout(250)
    state = {}
    def after_payment():
        page.wait_for_url(re.compile(r'/receipts/[0-9a-f-]{36}'), timeout=8000); page.wait_for_load_state('networkidle')
        expect(page.locator('main')).to_contain_text('receipt', ignore_case=True)
        page.go_back(); page.wait_for_load_state('networkidle'); page.wait_for_timeout(400)
        expect(page.locator('main')).to_contain_text('Phone')

    # ---------------- Landing & auth ----------------
    @step('landing page loads for signed-out visitor')
    def _():
        go('')
        expect(page.get_by_role('link', name=re.compile('Start free trial|Get started|Sign in', re.I)).first).to_be_visible()
        page.screenshot(path=f'{OUT}/01-landing.png')

    @step('sign-in rejects a wrong password with a clear message')
    def _():
        go('login')
        page.locator('input[type=email]').fill('admin@xelorsoft.com')
        page.locator('input[autocomplete=current-password]').fill('wrong-password')
        page.locator('form button.btn.primary').click()
        expect(page.locator('.notice, [role=alert]').first).to_be_visible(timeout=8000)
        msg = page.locator('form').inner_text()
        if 'invalid' not in msg.lower() and 'incorrect' not in msg.lower() and 'wrong' not in msg.lower():
            note('UX', f'wrong-password message unclear: {msg[:120]!r}')

    @step('sign-up blocks short passwords before calling the server')
    def _():
        go('login?mode=signup')
        page.locator('input[autocomplete=name]').fill('QA Owner')
        page.locator('input[type=email]').fill(EMAIL)
        page.locator('input[autocomplete=new-password]').fill('short')
        btn = page.locator('form button.btn.primary')
        if btn.is_enabled():
            btn.click(); page.wait_for_timeout(800)
            body = page.locator('form').inner_text()
            if '8' not in body:
                note('BUG', 'sign-up with a 5-character password was not blocked with a message (page says “Use at least 8 characters”)')
        state['short_pw_users'] = sql(f"select count(*) from auth.users where email = '{EMAIL}'")[0][0]
        if state['short_pw_users'] != '0':
            note('BUG', 'account was created with a password shorter than the stated 8-character minimum')

    @step('sign-up creates the account and asks for gym details')
    def _():
        if state.get('short_pw_users') != '0':
            go('login'); return
        go('login?mode=signup')
        page.locator('input[autocomplete=name]').fill('QA Owner')
        page.locator('input[type=email]').fill(EMAIL)
        page.locator('input[autocomplete=new-password]').fill(PASSWORD)
        page.locator('form button.btn.primary').click()
        expect(page.get_by_role('heading', name='Set up your gym')).to_be_visible(timeout=10000)
        page.screenshot(path=f'{OUT}/02-setup-gym.png')

    @step('create gym → setup wizard opens')
    def _():
        if not page.get_by_role('heading', name='Set up your gym').count():
            go('login'); page.locator('input[type=email]').fill(EMAIL); page.locator('input[autocomplete=current-password]').fill(PASSWORD)
            page.locator('form button.btn.primary').click(); page.wait_for_timeout(1500)
        page.locator('input[autocomplete=organization]').fill(GYM)
        page.locator('form button.btn.primary').click()
        page.wait_for_url(re.compile(r'/g/[^/]+/welcome'), timeout=10000)
        state['slug'] = re.search(r'/g/([^/]+)/', page.url).group(1)
        state['gym'] = sql(f"select id from gyms where slug = '{state['slug']}'")[0][0]
        expect(page.get_by_role('heading', name='Welcome to XS Gym')).to_be_visible(timeout=8000)
        if page.locator('nav.sidebar, nav.tabbar').count(): note('BUG', 'setup wizard shows the app navigation')
        page.wait_for_load_state('networkidle'); page.screenshot(path=f'{OUT}/03-onboarding-gym.png')

    @step('setup wizard: gym details → plans with prices → skip member and team → done')
    def _():
        page.get_by_label('Gym phone').fill('9876500077')
        tap(page.get_by_role('group', name='Grace days').get_by_role('button', name='5 days'))
        tap(page.get_by_role('button', name='Continue'))
        expect(page.get_by_role('heading', name='What do you sell?')).to_be_visible(timeout=8000)
        for name in ['Quarterly', 'Half-yearly', 'Yearly']:
            page.get_by_role('checkbox', name=re.compile(f'^{name} ')).uncheck()
        page.get_by_role('checkbox', name=re.compile('^Day pass ')).check()
        page.get_by_label('Monthly price').fill('abc')
        if page.get_by_role('button', name=re.compile('Add 2 plans')).is_enabled(): note('BUG', 'setup allows a non-numeric plan price')
        page.get_by_label('Monthly price').fill('1000')
        page.screenshot(path=f'{OUT}/03-onboarding-plans.png', full_page=True)
        tap(page.get_by_role('button', name='Add 2 plans'))
        expect(page.get_by_role('heading', name='Add your first member')).to_be_visible(timeout=8000)
        tap(page.get_by_role('button', name='Skip for now'))
        expect(page.get_by_role('heading', name='Bring your team')).to_be_visible(timeout=8000)
        page.get_by_label('Staff email').fill('nobody-here@example.com')
        tap(page.get_by_role('button', name='Add to team'))
        expect(page.locator('main')).to_contain_text('sign up first', timeout=8000)
        tap(page.get_by_role('button', name='Skip for now'))
        expect(page.get_by_role('heading', name="You're all set")).to_be_visible(timeout=8000)
        page.screenshot(path=f'{OUT}/03-onboarding-done.png', full_page=True)
        rows = sql(f"select name, price_paise, duration_unit from membership_plans where gym_id = '{state['gym']}' order by name")
        assert rows == [['Day pass', '15000', 'day'], ['Monthly', '100000', 'month']], f'plans after setup: {rows}'
        g = sql(f"select grace_days, phone, onboarded_at is not null from gyms where id = '{state['gym']}'")[0]
        assert g == ['5', '9876500077', 't'], f'gym after setup: {g}'
        tap(page.get_by_role('button', name='Go to dashboard'))
        page.wait_for_url(re.compile(r'/g/[^/]+$'), timeout=8000); page.wait_for_load_state('networkidle')
        expect(page.locator('.start-card')).to_contain_text('Getting started', timeout=8000)
        page.reload(); page.wait_for_load_state('networkidle')
        if '/welcome' in page.url: note('BUG', 'finished setup still opens the wizard after reload')
        page.screenshot(path=f'{OUT}/03-dashboard-new.png', full_page=True)

    base = lambda: f"g/{state['slug']}"

    # ---------------- Plans ----------------
    @step('add a plan on Plans (Couple monthly ₹1,800), invalid price blocked')
    def _():
        nav('Plans')
        for name, length, unit, price in [('Couple monthly', '1', 'Months', '1800')]:
            tap(page.get_by_role('button', name=re.compile('Add (your first )?plan')).first)
            d = dialog(); expect(d).to_be_visible()
            d.get_by_label('Plan name').fill(name)
            d.get_by_label('Length').fill(length)
            tap(d.get_by_role('group', name='Unit').get_by_role('button', name=unit))
            d.get_by_label('Price').fill('abc')
            if d.locator('form button.btn.primary.block:not([type=button])').is_enabled(): note('BUG', 'plan form allows saving a non-numeric price')
            d.get_by_label('Price').fill(price)
            tap(d.locator('form button.btn.primary.block:not([type=button])'))
            toast('Plan added')
            expect(dialog()).to_have_count(0, timeout=5000)
        n = sql(f"select count(*) from membership_plans where gym_id = '{state['gym']}'")[0][0]
        assert n == '3', f'expected 3 plans in DB, found {n}'

    # ---------------- Members ----------------
    @step('add member: validation then save → member page offers a sale')
    def _():
        nav('Members')
        tap(page.get_by_role('link', name=re.compile('Add member')).first)
        page.wait_for_load_state('networkidle')
        page.get_by_label('Full name').fill('Rahul QA')
        page.get_by_label('Mobile number').fill('98470')
        expect(page.get_by_text('Enter 10 digits')).to_be_visible()
        assert page.locator('main button.btn.primary').is_disabled(), 'Add member enabled with a 5-digit phone'
        page.get_by_label('Mobile number').fill('98470 12345')
        tap(page.locator('main button.btn.primary'))
        toast('Member added')
        page.wait_for_url(re.compile(r'/members/[0-9a-f-]{36}'), timeout=8000)
        state['member'] = re.search(r'/members/([0-9a-f-]{36})', page.url).group(1)
        page.wait_for_timeout(600)
        if not dialog().count(): note('UX', 'after adding a member the sell-plan sheet did not open automatically (?sell=1)')
        page.screenshot(path=f'{OUT}/04-member-new-sale.png')

    @step('duplicate phone number is rejected with a readable error')
    def _():
        if dialog().count(): tap(dialog().get_by_role('button', name='Close'))
        go(base() + '/members/new')
        page.get_by_label('Full name').fill('Duplicate Person')
        page.get_by_label('Mobile number').fill('9847012345')
        tap(page.locator('main button.btn.primary'))
        err = page.locator('main .notice, .toasts .toast.bad').first
        expect(err).to_be_visible(timeout=8000)
        text = err.inner_text()
        if re.search(r'duplicate key|violates|23505|constraint', text, re.I): note('BUG', f'raw database error shown for duplicate phone: {text[:140]!r}')
        state['dup_msg'] = text

    @step('sell Monthly with admission ₹500 and discount ₹100 (reason required)')
    def _():
        go(base() + f"/members/{state['member']}")
        tap(page.get_by_role('button', name=re.compile('Sell plan|Renew')))
        d = dialog(); expect(d).to_be_visible()
        tap(d.get_by_role('radio', name=re.compile('Monthly')))
        d.get_by_label('Admission fee (optional)').fill('500')
        d.get_by_label('Discount (optional)').fill('5000')
        if d.locator('form button.btn.primary.block:not([type=button])').is_enabled(): note('BUG', 'discount larger than the plan price is accepted')
        d.get_by_label('Discount (optional)').fill('100')
        if d.get_by_label('Reason for discount').count() and d.locator('form button.btn.primary.block:not([type=button])').is_enabled():
            note('BUG', 'discount can be given without a reason')
        if d.get_by_label('Reason for discount').count(): d.get_by_label('Reason for discount').fill('Opening offer')
        expect(d).to_contain_text('₹1,400')
        tap(d.locator('form button.btn.primary.block:not([type=button])'))
        toast('Monthly')
        due = sql(f"select due_paise from member_overview where id = '{state['member']}'")[0][0]
        assert due == '140000', f'due should be ₹1,400 (140000 paise), DB has {due}'

    @step('sale with money due opens the payment sheet; ₹1,000 UPI with double-tap → recorded once')
    def _():
        page.wait_for_timeout(500)
        d = dialog()
        if not (d.count() and 'Record payment' in d.inner_text()):
            note('UX', 'payment sheet did not open after a sale with money due'); tap(page.get_by_role('button', name='Payment'))
        expect(d).to_be_visible()
        if d.get_by_label('Amount received').input_value() != '1400': note('UX', f"payment amount not pre-filled with the ₹1,400 due ({d.get_by_label('Amount received').input_value()!r})")
        d.get_by_label('Amount received').fill('1000')
        tap(d.get_by_role('group', name='Payment method').get_by_role('button', name='UPI'))
        d.get_by_label('UPI reference (optional)').fill('UTR998877')
        btn = d.locator('form button.btn.primary.block:not([type=button])')
        if not touch: btn.dblclick()
        else:
            # A second activation of the same button (not a tap at its old
            # position, which after the sheet closes is the tab bar).
            handle = btn.element_handle()
            btn.tap()
            try: handle.dispatch_event('click')
            except Exception: pass
        toast('recorded')
        after_payment()
        n = sql(f"select count(*), coalesce(sum(amount_paise),0) from payments where member_id = '{state['member']}'")[0]
        assert n[0] == '1', f'double-tap created {n[0]} payments (sum {n[1]} paise)'
        due = sql(f"select due_paise from member_overview where id = '{state['member']}'")[0][0]
        assert due == '40000', f'due after ₹1,000 should be ₹400, DB has {due}'

    @step('amount field rejects “12.345” and negative values')
    def _():
        tap(page.get_by_role('button', name='Payment'))
        d = dialog()
        for bad in ['12.345', '-50', '0']:
            d.get_by_label('Amount received').fill(bad)
            if d.locator('form button.btn.primary.block:not([type=button])').is_enabled(): note('BUG', f'payment amount {bad!r} can be submitted')
        tap(d.get_by_role('button', name='Close'))
        expect(dialog()).to_have_count(0, timeout=4000)

    @step('overpay ₹600 against ₹400 due → ₹200 shown as credit')
    def _():
        tap(page.get_by_role('button', name='Payment'))
        d = dialog(); d.get_by_label('Amount received').fill('600')
        tap(d.get_by_role('group', name='Payment method').get_by_role('button', name='Cash'))
        tap(d.locator('form button.btn.primary.block:not([type=button])')); toast('recorded'); after_payment()
        row = sql(f"select due_paise, credit_paise from member_overview where id = '{state['member']}'")[0]
        assert row == ['0', '20000'], f'expected due 0 / credit 20000, got {row}'
        page.wait_for_timeout(500)
        if '200' not in page.locator('main').inner_text(): note('UX', 'member page does not show the ₹200 credit after overpayment')

    @step('receipt opens with allocations and prints')
    def _():
        tap(page.get_by_role('link', name='Receipt').first)
        page.wait_for_load_state('networkidle')
        expect(page.locator('main')).to_contain_text('Rahul QA')
        page.screenshot(path=f'{OUT}/05-receipt.png', full_page=True)
        page.go_back(); page.wait_for_load_state('networkidle')
        expect(page.locator('main')).to_contain_text('Rahul QA')

    @step('reverse the ₹600 cash payment → dues come back, receipt marked reversed')
    def _():
        page.reload(); page.wait_for_load_state('networkidle')
        rows = page.locator('main li', has_text='600')
        tap(rows.first.get_by_role('button', name='Reverse'))
        d = dialog()
        assert d.get_by_role('button', name='Reverse payment').is_disabled(), 'reverse allowed without a reason'
        d.get_by_label('Reason (required)').fill('Wrong amount')
        tap(d.get_by_role('button', name='Reverse payment')); toast('Payment reversed')
        row = sql(f"select due_paise, credit_paise from member_overview where id = '{state['member']}'")[0]
        assert row == ['40000', '0'], f'after reversing ₹600 expected due 40000 / credit 0, got {row}'

    @step('void a paid charge is refused with a readable message')
    def _():
        voids = page.locator('main').get_by_role('button', name='Void')
        if not voids.count(): note('INFO', 'no Void button on charges with payments'); return
        tap(voids.first)
        d = dialog(); d.get_by_label('Reason (required)').fill('Test void')
        tap(d.get_by_role('button', name='Void charge'))
        page.wait_for_timeout(1500)
        text = (d.inner_text() if d.count() else '') + page.locator('.toasts').inner_text()
        st = sql(f"select status from charges where member_id = '{state['member']}' order by created_at")
        if any(s[0] == 'void' for s in st):
            credit = sql(f"select credit_paise from member_overview where id = '{state['member']}'")[0][0]
            note('DECISION', f'a paid charge can be voided; its payment becomes credit ({int(credit)//100} ₹). The membership itself stays active')
        if d.count():
            if re.search(r'violates|exception|P0001|SQLSTATE', text): note('BUG', f'raw database error on void: {text[:160]!r}')
            if not re.search(r'[a-z]', text.replace('Void charge', '')): note('UX', 'void failed silently')
            tap(d.get_by_role('button', name='Close'))
        elif 'voided' not in text.lower():
            note('UX', f'void finished with no confirmation: {text[:100]!r}')

    @step('edit member name and email')
    def _():
        if dialog().count(): tap(dialog().get_by_role('button', name='Close'))
        tap(page.locator('main').get_by_role('button', name='Edit'))
        d = dialog(); d.get_by_label('Full name').fill('Rahul QA Edited')
        tap(d.get_by_role('button', name=re.compile('More details'))) if d.get_by_role('button', name=re.compile('More details')).count() else None
        d.get_by_label('Email').fill('not-an-email')
        page.wait_for_timeout(200)
        if d.locator('button.btn.primary').is_enabled():
            tap(d.locator('button.btn.primary')); page.wait_for_timeout(1200)
            saved = sql(f"select email from members where id = '{state['member']}'")[0][0]
            if saved == 'not-an-email': note('BUG', 'member email is saved without validation ("not-an-email")')
            if dialog().count():
                d.get_by_label('Email').fill('rahul.qa@example.com'); tap(d.locator('button.btn.primary'))
        toast('Member updated')
        assert sql(f"select full_name from members where id = '{state['member']}'")[0][0] == 'Rahul QA Edited'

    @step('refresh on a deep link keeps the user on the same screen')
    def _():
        page.reload(); page.wait_for_load_state('networkidle')
        expect(page.locator('main')).to_contain_text('Rahul QA Edited', timeout=8000)

    @step('archive then restore member')
    def _():
        tap(page.get_by_role('button', name='Archive member'))
        d = dialog(); d.get_by_label('Reason (required)').fill('Moved away')
        tap(d.get_by_role('button', name='Archive')); page.wait_for_timeout(1200)
        assert sql(f"select status from members where id = '{state['member']}'")[0][0] == 'archived'
        tap(page.locator('main').get_by_role('button', name=re.compile('Restore')))
        toast('Member restored')
        assert sql(f"select status from members where id = '{state['member']}'")[0][0] == 'active'

    # ---------------- Member search ----------------
    @step('members search: by last phone digits, by name, unknown name, special characters')
    def _():
        nav('Members')
        box = page.get_by_role('searchbox', name='Search members')
        box.fill('12345'); page.wait_for_timeout(900)
        expect(page.locator('main')).to_contain_text('Rahul QA Edited')
        box.fill('rahul'); page.wait_for_timeout(900)
        expect(page.locator('main')).to_contain_text('Rahul QA Edited')
        box.fill('zzzz nobody'); page.wait_for_timeout(900)
        expect(page.locator('main')).not_to_contain_text('Rahul QA Edited')
        box.fill('(%,*'); page.wait_for_timeout(900)
        if page.locator('main .notice').count(): note('BUG', 'special characters in search show an error')

    @step('check-in is gone from the web app (nav, member page, old link)')
    def _():
        go(base() + f"/members/{state['member']}")
        nav_text = page.locator('nav.tabbar, nav.sidebar').first.inner_text()
        assert 'Check in' not in nav_text, 'Check in still in navigation'
        assert page.locator('main').get_by_role('button', name=re.compile('Check in|Override')).count() == 0, 'Check in button on member page'
        go(base() + '/check-in'); page.wait_for_timeout(600)
        assert '/check-in' not in page.url, f'old check-in link still opens a page: {page.url}'

    # ---------------- Payments, expenses, reports ----------------
    @step('payments screen shows today’s collections; reversed one excluded from total')
    def _():
        nav('Payments')
        # Section navigation and async query hydration can race on slower CI
        # tablets. Wait for the actual payment row before reading the table.
        expect(page.locator('main')).to_contain_text('Rahul QA Edited', timeout=12000)
        main = page.locator('main').inner_text()
        if '1,600' in main: note('BUG', 'reversed payment is included in the day total on Payments')
        page.screenshot(path=f'{OUT}/06-payments.png', full_page=True)

    @step('add expense ₹2,500 Electricity, future date blocked, then reverse it')
    def _():
        nav('Expenses')
        tap(page.get_by_role('button', name='Add expense').first)
        d = dialog(); tap(d.get_by_role('button', name='Electricity')) if d.get_by_role('button', name='Electricity').count() else d.get_by_label('Category').fill('Electricity')
        d.get_by_label('Amount').fill('2500')
        mx = d.get_by_label('Date').get_attribute('max')
        if not mx: note('BUG', 'expense date allows future dates')
        tap(d.locator('form button.btn.primary.block:not([type=button])')); toast('expense saved')
        exp = sql(f"select id, amount_paise from expenses where gym_id = '{state['gym']}'")
        assert exp and exp[0][1] == '250000', f'expense not stored correctly: {exp}'
        tap(page.locator('main').get_by_role('button', name='Reverse').first)
        d = dialog(); d.get_by_label('Reason (required)').fill('Entered twice')
        tap(d.get_by_role('button', name='Reverse expense')); toast('Expense reversed')
        assert sql(f"select count(*) from expense_reversals where gym_id = '{state['gym']}'")[0][0] == '1'

    @step('dashboard numbers match the database')
    def _():
        nav('Home')
        main = page.locator('main').inner_text()
        s = json.loads(sql(f"select set_config('request.jwt.claim.sub', user_id::text, true), public.dashboard_summary(gym_id)::text from gym_staff where gym_id = '{state['gym']}' and role = 'owner'")[0][1])
        f = s['financial']
        want = f"₹{f['collections_today'] // 100:,}"
        if want not in main: note('BUG', f'dashboard "Collected today" does not show {want}; DB says {f}')
        page.screenshot(path=f'{OUT}/07-dashboard.png', full_page=True)

    @step('analytics: KPIs and charts match the database, table view, period switch')
    def _():
        nav('Analytics')
        expect(page.locator('.analytics-kpis .tile')).to_have_count(8, timeout=8000)
        a = json.loads(sql(f"select set_config('request.jwt.claim.sub', user_id::text, true), public.gym_analytics(gym_id, 6)::text from gym_staff where gym_id = '{state['gym']}' and role = 'owner'")[0][1])
        cards = page.locator('.viz-card')
        if cards.count() < 9: note('BUG', f'analytics shows {cards.count()} charts, expected 10')
        if page.locator('.viz-card svg').count() < 4: note('BUG', 'analytics column/line charts did not draw')
        rev = page.locator('.viz-card', has_text='Revenue and expenses')
        tap(rev.get_by_role('button', name='Table'))
        cur = a['months'][-1]
        want = f"₹{cur['revenue_paise'] // 100:,}"
        if want not in rev.inner_text(): note('BUG', f'revenue table does not show {want} for {cur["month"]}')
        tap(rev.get_by_role('button', name='Chart'))
        box = rev.locator('svg').bounding_box()
        if box:
            page.mouse.move(box['x'] + box['width'] - 30, box['y'] + box['height'] / 2) if not touch else rev.locator('svg rect[fill=transparent]').tap(position={'x': box['width'] - 70, 'y': 60})
            page.wait_for_timeout(200)
            if not rev.locator('.viz-tip').count(): note('BUG', 'hovering/tapping a month shows no tooltip')
        tap(page.get_by_role('group', name='Period').get_by_role('button', name='12 months')); page.wait_for_timeout(800)
        if page.locator('main .notice.bad').count(): note('BUG', 'analytics 12 months shows an error')
        page.screenshot(path=f'{OUT}/08-analytics.png', full_page=True)

    @step('analytics lists: daily summary, dues and expiring tabs, CSV download, WhatsApp reminder')
    def _():
        tap(page.get_by_role('group', name='View').get_by_role('button', name='Overview'))
        for tab in ['Daily', 'Dues', 'Expiring']:
            tap(page.get_by_role('button', name=tab)); page.wait_for_timeout(500)
            if page.locator('main .notice.bad, main [class*="bad"]').filter(has_text=re.compile('error|wrong', re.I)).count(): note('BUG', f'reports {tab} shows an error')
        tap(page.get_by_role('group', name='View').get_by_role('button', name='Dues')); page.wait_for_timeout(500)
        remind = page.get_by_role('button', name=re.compile('^Remind'))
        if remind.count():
            tap(remind.first)
            link = dialog().get_by_role('link', name='Open WhatsApp')
            href = link.get_attribute('href') or ''
            if not re.match(r'^https://wa\.me/91\d{10}\?text=', href): note('BUG', f'WhatsApp link looks wrong: {href[:60]}')
            tap(dialog().get_by_role('group', name='Language').get_by_role('button', name='മലയാളം'))
            if 'ബാക്കി' not in dialog().locator('textarea').input_value(): note('BUG', 'Malayalam dues reminder text missing')
            page.keyboard.press('Escape'); page.wait_for_timeout(600)
            if dialog().count(): tap(dialog().get_by_role('button', name=re.compile('Close|Cancel')).first)
        tap(page.get_by_role('group', name='View').get_by_role('button', name='Daily')); page.wait_for_timeout(500)
        with page.expect_download(timeout=8000) as dl:
            tap(page.get_by_role('button', name='CSV').first)
        path = dl.value.path(); text = open(path, encoding='utf-8-sig').read()
        rows = list(csv.reader(io.StringIO(text)))
        assert len(rows) >= 2, f'CSV has {len(rows)} rows'
        state['csv_head'] = rows[0]
        if text.startswith('=') or any(c.startswith(('=', '+', '@')) for r in rows[1:] for c in r if c and not re.match(r'^[+-]?\d', c)):
            note('SECURITY', 'CSV cells start with formula characters')

    @step('enquiries: add, follow-up shows, joined creates the member, lost closes')
    def _():
        nav('Enquiries')
        for name, phone in [('Lead Joiner', '9811100001'), ('Lead Lost', '9811100002')]:
            tap(page.get_by_role('button', name='Add enquiry'))
            d = dialog(); d.get_by_label('Name').fill(name); d.get_by_label('Mobile').fill(phone)
            d.get_by_label('How did they find us').select_option('instagram')
            tap(d.get_by_role('button', name='Save enquiry')); toast('Enquiry saved')
            expect(dialog()).to_have_count(0, timeout=5000)
        expect(page.locator('main .list')).to_contain_text('Lead Joiner')
        tap(page.locator('.item.enquiry', has_text='Lead Lost').locator('.main-col'))
        tap(dialog().get_by_role('button', name='Mark lost')); toast('marked lost')
        tap(page.locator('.item.enquiry', has_text='Lead Joiner').locator('.main-col'))
        tap(dialog().get_by_role('button', name=re.compile('Joined'))); 
        page.wait_for_url(re.compile(r'/members/[0-9a-f-]{36}'), timeout=8000)
        rows = sql(f"select e.status, m.full_name from enquiries e left join members m on m.id = e.member_id where e.gym_id = '{state['gym']}' order by e.full_name")
        assert rows == [['joined', 'Lead Joiner'], ['lost', '']], f'enquiries in DB: {rows}'
        try: expect(page.get_by_role('button', name=re.compile('^WhatsApp'))).to_be_visible(timeout=8000)
        except AssertionError: note('BUG', 'member page has no WhatsApp button')
        page.screenshot(path=f'{OUT}/09-enquiry-member.png', full_page=True)

    # ---------------- Settings, staff, import, appearance ----------------
    @step('settings: grace days validation, save gym details')
    def _():
        nav('Settings')
        page.get_by_label('Grace days after expiry').fill('99')
        if page.locator('main form button.btn.primary').first.is_enabled(): note('BUG', 'grace days above 60 can be saved')
        page.get_by_label('Grace days after expiry').fill('5')
        page.get_by_label('Phone').first.fill('9447000000')
        tap(page.locator('main form button.btn.primary').first); toast('Settings saved')
        assert sql(f"select grace_days, phone from gyms where id = '{state['gym']}'")[0] == ['5', '9447000000']

    @step('staff: adding an unknown email explains what to do')
    def _():
        tap(page.get_by_role('button', name='Add staff'))
        d = dialog(); d.get_by_label('Email they signed up with').fill('nobody.here@example.com')
        tap(d.locator('form button.btn.primary.block:not([type=button])')); page.wait_for_timeout(1500)
        text = d.inner_text() if d.count() else page.locator('.toasts').inner_text()
        if re.search(r'violates|SQLSTATE|exception|P0001', text): note('BUG', f'raw error when adding unknown staff email: {text[:160]!r}')
        state['staff_unknown_msg'] = text[-160:]
        if d.count(): tap(d.get_by_role('button', name='Close'))

    @step('import CSV: good rows added, bad rows explained, duplicates reported')
    def _():
        go(base() + '/members/import')
        csv_text = 'name,phone,email,gender,date of birth,join date\n' \
                   'Anjali Import,9847000001,,female,,2026-10-01\n' \
                   'Bad Phone,12345,,,,\n' \
                   'Rahul Duplicate,9847012345,,,,\n' \
                   ',9847000002,,,,\n' \
                   '"Menon, Priya",9847000003,priya@example.com,,1995-02-30,\n'
        page.locator('input[type=file]').set_input_files({'name': 'members.csv', 'mimeType': 'text/csv', 'buffer': csv_text.encode()})
        page.wait_for_timeout(600)
        table = page.locator('main table').inner_text()
        state['import_preview'] = table
        dup = page.locator('main tr', has_text='Rahul Duplicate').inner_text()
        if 'Ready' in dup: note('UX', 'import preview marks a phone that already belongs to a member as Ready')
        if '1995-02-30' in table and 'Ready' in page.locator('main tr', has_text='Menon').inner_text():
            note('BUG', 'import accepts an impossible date of birth (30 Feb)')
        btn = page.locator('main button.btn.primary', has_text='Add')
        tap(btn)
        expect(page.locator('main')).to_contain_text('Added', timeout=15000)
        state['import_result'] = page.locator('main .notice').first.inner_text()
        names = [r[0] for r in sql(f"select full_name from members where gym_id = '{state['gym']}' order by full_name")]
        state['names'] = names
        if 'Bad Phone' in names: note('BUG', 'import added a member with a 5-digit phone')

    @step('appearance switch works and persists')
    def _():
        if PLATFORM == 'phone':
            tap(page.locator('nav.tabbar').get_by_role('button', name='More'))
            tap(dialog().get_by_role('group', name='Appearance').get_by_role('button', name='Dark'))
            tap(dialog().get_by_role('button', name='Close'))
        else:
            nav('Settings'); tap(page.locator('main').get_by_role('group', name='Appearance').get_by_role('button', name='Dark'))
        page.reload(); page.wait_for_load_state('networkidle')
        assert page.evaluate('document.documentElement.dataset.theme') == 'dark'
        page.screenshot(path=f'{OUT}/08-dark.png', full_page=True)

    # ---------------- Navigation & isolation ----------------
    @step('back button walks history without blank screens')
    def _():
        go(base()); nav('Members'); tap(page.locator('main a[href*="/members/"]').filter(has_text='Anjali').first)
        page.wait_for_load_state('networkidle')
        page.go_back(); page.wait_for_load_state('networkidle'); expect(page.locator('main h1')).to_have_text('Members')
        page.go_back(); page.wait_for_load_state('networkidle'); expect(page.locator('main h1')).to_be_visible()

    @step('tenant isolation: QA owner cannot open the demo gym')
    def _():
        go('g/xs-fitness-studio')
        page.wait_for_timeout(800)
        txt = page.locator('body').inner_text()
        if 'XS Fitness Studio' in txt or 'Good ' in page.locator('main').inner_text() if page.locator('main').count() else False:
            note('SECURITY', 'QA owner can see the demo gym')
        page.screenshot(path=f'{OUT}/09-other-gym.png')
        state['other_gym_text'] = txt[:120]

    @step('API refuses cross-tenant writes (record payment into demo gym)')
    def _():
        demo = sql("select g.id, m.id from gyms g join members m on m.gym_id = g.id where g.slug = 'xs-fitness-studio' limit 1")[0]
        status = page.evaluate("""async ([gym, member]) => {
            const key = Object.keys(localStorage).find(k => k.endsWith('-auth-token'));
            const tok = JSON.parse(localStorage.getItem(key)).access_token;
            const r = await fetch('http://localhost:54321/rest/v1/rpc/record_payment', { method: 'POST',
              headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
              body: JSON.stringify({ p_gym: gym, p_member: member, p_amount_paise: 100, p_method: 'cash', p_idempotency_key: crypto.randomUUID() }) });
            return [r.status, await r.text()]; }""", demo)
        before = state.setdefault('demo_100', None)
        n = sql(f"select count(*) from payments where gym_id = '{demo[0]}' and amount_paise = 100 and received_at > now() - interval '1 minute'")[0][0]
        assert n == '0' and status[0] >= 400 and 'PGRST202' not in status[1], f'cross-tenant payment accepted (HTTP {status}, rows {n})'
        state['cross_tenant_error'] = status[1][:160]

    @step('network failure while recording a payment shows an error, no stuck spinner')
    def _():
        go(base() + f"/members/{state['member']}")
        page.route('**/rest/v1/rpc/record_payment', lambda r: r.abort('internetdisconnected'))
        tap(page.get_by_role('button', name='Payment'))
        d = dialog(); d.get_by_label('Amount received').fill('100')
        tap(d.locator('form button.btn.primary.block:not([type=button])')); page.wait_for_timeout(2000)
        text = d.inner_text() if d.count() else ''
        if d.count() and d.locator('.spinner').count(): note('BUG', 'payment button keeps spinning after a network failure')
        if d.count() and not re.search(r'connect|network|internet|offline|try again|failed', text, re.I):
            note('UX', f'network failure message is unclear: {text[-120:]!r}')
        page.unroute('**/rest/v1/rpc/record_payment')
        if d.count(): tap(d.get_by_role('button', name='Close'))

    @step('session survives a reload; sign out returns to landing; protected URL asks to sign in')
    def _():
        page.reload(); page.wait_for_load_state('networkidle')
        expect(page.locator('main')).to_contain_text('Rahul QA Edited')
        if PLATFORM == 'phone':
            tap(page.locator('nav.tabbar').get_by_role('button', name='More')); tap(dialog().get_by_role('button', name='Sign out'))
        else:
            tap(page.locator('nav.sidebar').get_by_role('button', name='Sign out'))
        page.wait_for_timeout(1200)
        go(base() + '/payments'); page.wait_for_timeout(800)
        log = [json.loads(l) for l in open(HERE + '/calls.jsonl')]
        leaked = [c for c in log if c['user'] is None and c['path'].startswith('/rest/') and c['status'] == 200]
        if leaked: note('SECURITY', f'signed-out requests returned data: {[c["path"] for c in leaked][:3]}')
        if 'Rahul QA' in page.locator('body').inner_text(): note('SECURITY', f'signed-out user saw member names at {page.url}')
        state['signed_out_landing'] = page.url

    # ---------------- Demo owner: heavy data ----------------
    @step('demo owner: sign in, members filters and search on 76 members')
    def _():
        go('login')
        page.locator('input[type=email]').fill('admin@xelorsoft.com'); page.locator('input[autocomplete=current-password]').fill(DEMO_PASSWORD)
        page.locator('input[autocomplete=current-password]').press('Enter')
        page.wait_for_url(re.compile('/g/'), timeout=10000); page.wait_for_load_state('networkidle')
        nav('Members')
        counts = {}
        for f in ['All', 'Active', 'Expiring', 'Expired', 'Dues', 'Archived']:
            tap(page.locator('main').get_by_role('button', name=f, exact=True)); page.wait_for_load_state('networkidle'); page.wait_for_timeout(300)
            counts[f] = page.locator('main ul.list > li').count()
        state['filter_counts'] = counts
        db_dues = sql("select count(*) from member_overview o join gyms g on g.id=o.gym_id where g.slug='xs-fitness-studio' and o.status='active' and due_paise > 0")[0][0]
        if str(counts['Dues']) != db_dues: note('BUG', f'Dues filter shows {counts["Dues"]} rows, database has {db_dues}')

    @step('demo owner: reversed payments are marked on Payments and receipts')
    def _():
        rev = sql("select p.id, (p.received_at at time zone 'Asia/Kolkata')::date from payment_reversals r join payments p on p.id = r.payment_id join gyms g on g.id=p.gym_id where g.slug='xs-fitness-studio' limit 1")
        if not rev: note('INFO', 'no reversed payment in demo data'); return
        go(f'g/xs-fitness-studio/receipts/{rev[0][0]}')
        expect(page.locator('main')).to_contain_text('Reversed', timeout=8000)

    @step('demo owner: every screen loads without errors')
    def _():
        for label in ['Home', 'Members', 'Payments', 'Analytics', 'Enquiries', 'Plans', 'Expenses', 'Settings']:
            t = time.time(); nav(label); dt = time.time() - t
            if page.locator('main .notice.bad').count(): note('BUG', f'{label} shows an error notice')
            if dt > 2.5: note('PERF', f'{label} took {dt:.1f}s to settle on {PLATFORM}')
            page.screenshot(path=f'{OUT}/demo-{label.lower().replace(" ", "-")}.png', full_page=True)

    # ---------------- Layout checks ----------------
    @step('no horizontal overflow, tap targets ≥ 40px on touch')
    def _():
        bad = page.evaluate('''() => {
          const out = []; const vw = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth > vw + 1) out.push('page scrolls sideways');
          return out; }''')
        for b in bad: note('LAYOUT', f'{PLATFORM}: {b}')
        if touch:
            small = page.evaluate('''() => [...document.querySelectorAll('main a, main button, nav a, nav button')]
              .filter(e => e.offsetParent).map(e => [e.innerText.trim().slice(0,24) || e.getAttribute('aria-label'), e.getBoundingClientRect()])
              .filter(([, r]) => r.height < 40 && r.width < 40).map(([t, r]) => `${t} ${Math.round(r.width)}×${Math.round(r.height)}`).slice(0, 8)''')
            if small: note('LAYOUT', f'{PLATFORM}: small tap targets: {small}')

    ok = sum(1 for r in results if r[1] == 'ok')
    summary = {'platform': PLATFORM, 'passed': ok, 'total': len(results), 'results': results, 'problems': problems,
               'console_errors': sorted(set(console_errors))[:20], 'page_errors': page_errors[:20], 'state': {k: v for k, v in state.items() if k not in ('gym',)}}
    json.dump(summary, open(f'{OUT}/summary.json', 'w'), indent=1, default=str)
    print(f'\n{PLATFORM}: {ok}/{len(results)} steps passed, {len(problems)} notes, {len(set(console_errors))} console errors, {len(page_errors)} page errors')
    for e in sorted(set(console_errors))[:10]: print('  console:', e[:200])
    for e in page_errors[:10]: print('  pageerror:', e[:200])
    browser.close()
    sys.exit(0 if ok == len(results) else 1)
