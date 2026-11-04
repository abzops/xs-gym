// Renders the production build with mocked API responses and checks every
// main screen at phone, tablet and laptop sizes: no horizontal overflow, no
// console errors, primary content present. Saves screenshots to OUT_DIR.
//   node tests/ui/screens.mjs <playwright-module-path> <base-url> <out-dir>
import { createRequire } from 'node:module';

const [pwPath, baseUrl, outDir] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwPath);

const REF = 'knuanihnxtxtyrgvsumq';
const userId = '11111111-1111-4111-8111-111111111111';
const gym = { id: '22222222-2222-4222-8222-222222222222', name: 'Iron Temple Kozhikode', slug: 'iron-temple', timezone: 'Asia/Kolkata',
  currency: 'INR', phone: null, email: null, address: null, grace_days: 3, status: 'active', created_at: '2026-11-01T00:00:00Z' };
const perms = ['members.read','members.write','members.archive','members.export','plans.read','plans.manage','memberships.sell','memberships.cancel',
  'attendance.checkin','attendance.override','attendance.correct','payments.record','payments.read','payments.reverse','discounts.apply','charges.void',
  'expenses.record','expenses.read','expenses.reverse','reports.operational','reports.financial','staff.read','staff.manage','gym.settings','billing.manage','audit.read'];
const member = (i, over = {}) => ({
  id: `33333333-3333-4333-8333-33333333333${i}`, gym_id: gym.id, member_no: `XS-000${i}`, full_name: ['Rahul Krishnan', 'Anjali Menon', 'Mohammed Shafi', 'Priya Nair', 'Arjun Das'][i - 1],
  phone: `+9198765000${i}${i}`, email: null, gender: null, date_of_birth: null, address: null, emergency_contact: null, join_date: '2026-10-02',
  status: 'active', created_at: '2026-10-02T05:00:00Z', membership_id: 'm', plan_name: 'Monthly', start_date: '2026-10-20', end_date: '2026-11-19',
  valid_until: '2026-11-19', membership_status: 'active', due_paise: 0, credit_paise: 0, last_check_in_at: '2026-11-05T02:40:00Z', ...over,
});
const members = [member(1, { due_paise: 50000 }), member(2), member(3, { membership_status: 'grace', valid_until: '2026-11-03', end_date: '2026-11-03' }),
  member(4, { membership_status: 'expired', valid_until: '2026-10-01' }), member(5, { plan_name: null, valid_until: null, membership_status: 'none' })];

function body(url) {
  const u = new URL(url);
  const p = u.pathname;
  if (p.includes('/rpc/dashboard_summary')) return { today: '2026-11-05', timezone: 'Asia/Kolkata', active_members: 128, in_grace: 6, expiring_today: 2,
    expiring_7_days: 14, expiring_30_days: 41, expired_last_30_days: 9, new_members_month: 12, checkins_today: 47,
    financial: { collections_today: 1850000, collections_month: 21450000, cash_today: 1100000, upi_today: 750000, other_today: 0, reversals_today: 0,
      reversals_month: 100000, expenses_today: 50000, expenses_month: 4200000, dues_total: 2350000, members_with_dues: 17 } };
  if (p.includes('/rpc/daily_report')) return Array.from({ length: 5 }, (_, i) => ({ day: `2026-11-0${5 - i}`, collections_paise: 1850000 - i * 100000,
    reversals_paise: i === 2 ? 100000 : 0, cash_paise: 1000000, upi_paise: 750000 - i * 100000, other_paise: 100000, expenses_paise: 50000, checkins: 47 - i, new_members: 1 }));
  if (p.endsWith('/gym_staff')) return u.searchParams.has('gym_id')
    ? (u.searchParams.get('select') === 'role' ? { role: 'owner' } : [{ id: 's1', gym_id: gym.id, user_id: userId, role: 'owner', status: 'active', display_name: 'Jazeel', email: 'owner@example.com' },
        { id: 's2', gym_id: gym.id, user_id: 'x', role: 'reception', status: 'active', display_name: 'Desk', email: 'desk@example.com' }])
    : [{ role: 'owner', status: 'active', gyms: { id: gym.id, name: gym.name, slug: gym.slug } }];
  if (p.endsWith('/gyms')) return gym;
  if (p.endsWith('/gym_subscriptions')) return { gym_id: gym.id, plan: 'max', status: 'trial', trial_started_at: '2026-11-01T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z', paid_until: null };
  if (p.endsWith('/role_permissions')) return perms.map((permission) => ({ permission }));
  if (p.endsWith('/member_overview')) return u.searchParams.has('id') ? members[0] : members;
  if (p.endsWith('/membership_plans')) return [
    { id: 'p1', gym_id: gym.id, name: 'Monthly', duration_unit: 'month', duration_count: 1, price_paise: 100000, description: null, status: 'active' },
    { id: 'p2', gym_id: gym.id, name: 'Quarterly', duration_unit: 'month', duration_count: 3, price_paise: 270000, description: 'Save ₹300', status: 'active' },
    { id: 'p3', gym_id: gym.id, name: 'Yearly', duration_unit: 'month', duration_count: 12, price_paise: 960000, description: null, status: 'active' }];
  if (p.endsWith('/attendance_events')) return members.slice(0, 4).map((m, i) => ({ id: `a${i}`, member_id: m.id, checked_in_at: `2026-11-05T0${3 - i}:1${i}:00Z`,
    membership_status: 'active', override_reason: null, voided_at: null, void_reason: null, members: { full_name: m.full_name, member_no: m.member_no } }));
  if (p.endsWith('/payments') && u.searchParams.get('id') === 'eq.py1') return [body(url.replace('id=eq.py1', 'x=1'))[0]];
  if (p.endsWith('/payments')) return [
    { id: 'py1', gym_id: gym.id, member_id: members[0].id, amount_paise: 100000, method: 'upi', received_at: '2026-11-05T03:30:00Z', reference: 'UTR 4521', notes: null,
      payment_reversals: [], members: { full_name: members[0].full_name, member_no: 'XS-0001', phone: '+919876500011' },
      payment_allocations: [{ amount_paise: 50000, charges: { description: 'Admission fee' } }, { amount_paise: 50000, charges: { description: 'Monthly · 20 Oct 2026 – 19 Nov 2026' } }] },
    { id: 'py2', gym_id: gym.id, member_id: members[1].id, amount_paise: 270000, method: 'cash', received_at: '2026-11-05T02:10:00Z', reference: null, notes: null,
      payment_reversals: [{ id: 'r', reason: 'Wrong member', reversed_at: '2026-11-05T02:20:00Z' }], members: { full_name: members[1].full_name, member_no: 'XS-0002' } }];
  if (p.endsWith('/member_memberships')) return [{ id: 'mm1', member_id: members[0].id, plan_id: 'p1', plan_name: 'Monthly', start_date: '2026-10-20', end_date: '2026-11-19', price_paise: 100000, status: 'active', cancel_reason: null, created_at: '2026-10-20T00:00:00Z' }];
  if (p.endsWith('/charges')) return [{ id: 'c1', member_id: members[0].id, membership_id: 'mm1', kind: 'membership', description: 'Monthly · 20 Oct 2026 – 19 Nov 2026',
    gross_paise: 100000, discount_paise: 0, net_paise: 100000, discount_reason: null, due_date: '2026-10-20', status: 'open', void_reason: null, created_at: '2026-10-20T00:00:00Z' }];
  if (p.endsWith('/expenses')) return [{ id: 'e1', amount_paise: 50000, expense_date: '2026-11-05', method: 'cash', description: 'Bulbs', created_at: '2026-11-05T04:00:00Z',
    expense_categories: { name: 'Maintenance' }, expense_reversals: [] }];
  if (p.endsWith('/expense_categories')) return [{ name: 'Maintenance' }];
  return [];
}

const fakeJwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const exp = Math.floor(Date.now() / 1000) + 3600;
const session = { access_token: fakeJwt({ sub: userId, exp, role: 'authenticated' }), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
  user: { id: userId, email: 'owner@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' } };

const viewports = [['phone', 390, 844], ['tablet', 768, 1024], ['ipad', 820, 1180], ['tablet-land', 1024, 768], ['ipad-land', 1180, 820], ['laptop', 1366, 768]];
const screens = [['dashboard', ''], ['members', '/members'], ['import', '/members/import'], ['member', `/members/${members[0].id}`], ['checkin', '/check-in'],
  ['payments', '/payments'], ['receipt', '/receipts/py1'], ['plans', '/plans'], ['expenses', '/expenses'], ['reports', '/reports'], ['settings', '/settings']];

const browser = await chromium.launch();
let failures = 0;
for (const [vpName, w, h] of viewports) {
  for (const [name, path, needle] of [['landing', '', 'Start free trial'], ['login', 'login', 'Sign in']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const ok = !overflow && errors.length === 0 && (await page.getByRole('link', { name: needle }).or(page.getByRole('button', { name: needle })).count()) > 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${vpName.padEnd(11)} ${name.padEnd(9)}${overflow ? ' OVERFLOW' : ''}${errors.length ? ' errors=' + errors.join(' | ') : ''}`);
    await page.screenshot({ path: `${outDir}/${vpName}-${name}.png`, fullPage: true });
    await page.close();
  }
}
for (const [vpName, w, h] of viewports) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await ctx.route(`https://${REF}.supabase.co/**`, (route) => {
    const accept = route.request().headers()['accept'] ?? '';
    let data = body(route.request().url());
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  for (const [name, path] of screens) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${baseUrl}g/${gym.slug}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      h1: document.querySelector('main h1')?.textContent ?? '',
    }));
    const ok = !r.overflow && errors.length === 0 && r.h1.length > 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${vpName.padEnd(11)} ${name.padEnd(9)} h1="${r.h1}"${r.overflow ? ' OVERFLOW' : ''}${errors.length ? ' errors=' + errors.slice(0, 2).join(' | ') : ''}`);
    await page.screenshot({ path: `${outDir}/${vpName}-${name}.png`, fullPage: true });
    await page.close();
  }
  await ctx.close();
}
// Interaction flow on a phone: push into a member, open and close a sheet, go back.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await ctx.route(`https://${REF}.supabase.co/**`, (route) => {
    const accept = route.request().headers()['accept'] ?? '';
    let data = body(route.request().url());
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl}g/${gym.slug}/members`, { waitUntil: 'networkidle' });
  await page.locator('.list .item').first().tap();
  await page.waitForURL(/\/members\/[0-9a-f-]{36}/);
  const vt = await page.evaluate(() => document.documentElement.dataset.vt);
  await page.getByRole('button', { name: 'Payment' }).tap();
  const sheetOpen = await page.getByRole('dialog', { name: 'Record payment' }).isVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const sheetClosed = (await page.getByRole('dialog').count()) === 0;
  await page.getByRole('link', { name: 'Members' }).first().tap();
  await page.waitForURL(/\/members$/);
  const ok = vt === 'push' && sheetOpen && sheetClosed && errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} flow        push=${vt} sheetOpen=${sheetOpen} sheetClosed=${sheetClosed}${errors.length ? ' errors=' + errors.join(' | ') : ''}`);
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAILURES` : 'ALL SCREENS OK');
process.exit(failures ? 1 : 0);
