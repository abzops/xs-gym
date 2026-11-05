import { Check, ChevronDown, Laptop, Minus, Smartphone, Tablet, Wallet } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from '../../components/ui';
import { formatINR } from '../../lib/money';
import './landing.css';

/* ------------------------------------------------------------------ helpers */

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Adds `.in` once the element scrolls into view (one-shot reveal). */
function Reveal({ children, className = '', as: Tag = 'div', delay = 0 }: {
  children: ReactNode; className?: string; as?: 'div' | 'section' | 'li' | 'article'; delay?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced()) { el.classList.add('in'); return; }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); }
    }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal ${className}`} style={{ ['--d' as string]: `${delay}ms` }}>{children}</Tag>;
}

/** True while the element is on screen and the tab is visible — animations pause otherwise. */
function useActive<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    const vis = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', vis);
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return [ref, onScreen && visible && !reduced()] as const;
}

/** Smoothly counts a number towards `value` with requestAnimationFrame. */
function useCountUp(value: number, ms = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced()) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/* ------------------------------------------------------------- live hero */

const PEOPLE = [
  ['Rahul Krishnan', 'XS-0142', 0], ['Anjali Menon', 'XS-0087', 100000], ['Mohammed Shafi', 'XS-0203', 0],
  ['Priya Nair', 'XS-0119', 270000], ['Arjun Das', 'XS-0056', 0], ['Fathima Rizwan', 'XS-0231', 100000],
  ['Vishnu Prasad', 'XS-0164', 0], ['Sneha Thomas', 'XS-0098', 15000], ['Akhil Raj', 'XS-0177', 0],
  ['Deepa Suresh', 'XS-0045', 100000],
] as const;

type Row = { key: number; name: string; no: string; time: string; paid: number };

function clock(minutesAfterSix: number) {
  const h = 6 + Math.floor(minutesAfterSix / 60);
  const m = minutesAfterSix % 60;
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} am`;
}

function LiveDesk() {
  const [ref, active] = useActive<HTMLDivElement>();
  const counter = useRef(4);
  const [rows, setRows] = useState<Row[]>(() =>
    [3, 2, 1, 0].map((i) => ({ key: i, name: PEOPLE[i][0], no: PEOPLE[i][1], time: clock(40 - i * 4), paid: PEOPLE[i][2] })));
  const [collected, setCollected] = useState(1850000);
  const [checkins, setCheckins] = useState(47);
  const [flash, setFlash] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const n = counter.current++;
      const p = PEOPLE[n % PEOPLE.length];
      const row: Row = { key: n, name: p[0], no: p[1], time: clock(41 + n * 2), paid: p[2] };
      setRows((r) => [row, ...r].slice(0, 5));
      setCheckins((c) => c + 1);
      if (p[2] > 0) { setCollected((c) => c + p[2]); setFlash(n); }
    }, 2600);
    return () => clearInterval(id);
  }, [active]);

  const shownCollected = useCountUp(collected);
  const shownCheckins = useCountUp(checkins, 400);

  return (
    <div className="phone" ref={ref} aria-label="XS Gym front desk, live preview">
      <div className="phone-screen">
        <div className="ph-top"><img src={`${import.meta.env.BASE_URL}brand/favicon.svg`} alt="" width={18} height={18} /> Iron Temple</div>
        <div className="ph-today">
          <span className="ph-date">Thursday, 5 November</span>
          <span className="ph-lead num">{formatINR(shownCollected)}</span>
          <span className="ph-cap">Collected today</span>
          <div className="ph-figs">
            <span><b className="num">{shownCheckins}</b>Payments</span>
            <span><b className="num">128</b>Active</span>
            <span><b className="num">2</b>Expire today</span>
          </div>
        </div>
        <div className="ph-list" style={{ height: 5 * 52 }}>
          {rows.map((r, i) => (
            <div key={r.key} className={`ph-row ${i === 0 ? 'enter' : ''}`} style={{ transform: `translateY(${i * 52}px)`, opacity: i === 4 ? 0 : 1 }}>
              <span className="ph-av">{r.name.split(' ').map((s) => s[0]).join('')}</span>
              <span className="ph-name">{r.name}<small>{r.no}</small></span>
              <span className="ph-end">
                <span className="ph-time num">{r.time}</span>
                {r.paid > 0 && <span className={`ph-paid ${flash === r.key ? 'pop' : ''}`}>+{formatINR(r.paid)}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ sections */

const STEPS = [
  { title: 'Type three letters', body: 'Name, last digits of the phone, or member number.', ui: <MiniSearch /> },
  { title: 'See their status', body: 'Active, in grace, expired — and any dues — at a glance.', ui: <MiniStatus /> },
  { title: 'Take the payment', body: 'Cash or UPI in two taps. The receipt is ready to share on WhatsApp.', ui: <MiniDone /> },
];

function MiniSearch() {
  return <div className="mini"><div className="mini-input">anj<span className="caret" /></div><div className="mini-hit"><b>Anjali Menon</b><small>XS-0087</small></div></div>;
}
function MiniStatus() {
  return <div className="mini"><div className="mini-hit"><b>Anjali Menon</b><small>Till 19 Nov 2026</small><span className="tag ok">Active</span></div><div className="mini-hit"><b>Arjun Das</b><small>₹500 due</small><span className="tag bad">Expired</span></div></div>;
}
function MiniDone() {
  return <div className="mini"><div className="mini-btn"><Wallet size={14} /> Record ₹1,500 UPI</div><div className="mini-toast"><Check size={14} /> ₹1,500 UPI from Anjali Menon recorded</div></div>;
}

const LEDGER = [
  { what: 'Monthly plan, 5 Nov – 4 Dec', amount: 100000, kind: 'charge' },
  { what: 'Admission fee', amount: 50000, kind: 'charge' },
  { what: 'Paid by UPI · UTR 4521', amount: -120000, kind: 'pay' },
  { what: 'Paid in cash', amount: -30000, kind: 'pay' },
] as const;

function Ledger() {
  let running = 0;
  return (
    <div className="ledger">
      {LEDGER.map((l, i) => {
        running += l.amount;
        return (
          <Reveal key={i} className="ledger-row" delay={i * 90}>
            <span>{l.what}</span>
            <span className={`num ${l.kind}`}>{l.amount > 0 ? '' : '−'}{formatINR(Math.abs(l.amount))}</span>
            <span className="num bal">{formatINR(running)}</span>
          </Reveal>
        );
      })}
      <Reveal className="ledger-total" delay={LEDGER.length * 90}>
        <span>Due now</span><span className="num">{formatINR(running)}</span>
      </Reveal>
    </div>
  );
}

const ROLES = ['Owner', 'Manager', 'Reception', 'Trainer'] as const;
const MATRIX: [string, boolean[]][] = [
  ['Look up members and their status', [true, true, true, true]],
  ['Add and edit members', [true, true, true, false]],
  ['Sell plans and record payments', [true, true, true, false]],
  ['Give discounts, reverse payments', [true, true, false, false]],
  ['See collections and reports', [true, true, false, false]],
  ['Manage staff and gym settings', [true, false, false, false]],
];

const FEATURES = [
  ['Members', 'Search, profiles, archive and restore, CSV import with a preview.'],
  ['Plans and renewals', 'Day or month plans; renewals continue from the last end date.'],
  ['XS AI', 'Ask or tell it, in English or Malayalam: dues, collections, payments, renewals.'],
  ['Payments', 'Cash, UPI, card or bank. Partial payments, credit and reversals.'],
  ['Receipts', 'Itemised, printable, and shareable to WhatsApp in one tap.'],
  ['Dues', 'Who owes what, computed from charges and payments — never typed in.'],
  ['Expenses', 'Rent, power, salaries. Corrections reverse, never overwrite.'],
  ['Reports', 'Daily collections, cash and UPI split, dues and expiry lists, CSV.'],
  ['Staff and roles', 'Every person signs in as themselves; roles limit what they can do.'],
  ['Audit trail', 'Every sale, payment, reversal and override is recorded.'],
];

const FAQ = [
  ['Is my gym’s data kept separate?', 'Yes. Every row belongs to one gym, and the database refuses any request that crosses gyms — not just the app screens.'],
  ['Do I need to install anything?', 'No. Open it in the browser on any phone, tablet or laptop. On a phone, Add to Home Screen and it opens full-screen like an app.'],
  ['Can my staff share one login?', 'They each get their own, so you always know who checked someone in or took a payment.'],
  ['What happens after the 30-day trial?', 'Nothing is deleted. You can still view and export everything; changes pause until the subscription is renewed.'],
  ['Can I bring my existing member list?', 'Yes. Import a CSV from Excel or Google Sheets. You see every row checked before anything is saved.'],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="faq">
      {FAQ.map(([q, a], i) => (
        <div key={q} className={`faq-item ${open === i ? 'open' : ''}`}>
          <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span>{q}</span><ChevronDown size={20} />
          </button>
          <div className="faq-a"><div><p>{a}</p></div></div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- page */

export function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  return (
    <div className="lp">
      <header className={`lp-nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="lp-wrap lp-nav-in">
          <Link to="/" aria-label="XS Gym home"><Logo onDark width={132} /></Link>
          <nav className="lp-links" aria-label="Sections">
            <a href="#desk">Front desk</a><a href="#money">Payments</a><a href="#features">Features</a><a href="#faq">Questions</a>
          </nav>
          <div className="row">
            <Link className="btn ghost on-dark" to="/login">Sign in</Link>
            <Link className="btn primary on-dark hide-phone" to="/login?mode=signup">Start free trial</Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-copy">
            <h1>
              <span className="line" style={{ ['--d' as string]: '60ms' }}>Run your gym simply.</span>
              <span className="line" style={{ ['--d' as string]: '160ms' }}>Know your numbers</span>
              <span className="line" style={{ ['--d' as string]: '260ms' }}>accurately.</span>
            </h1>
            <p className="rise" style={{ ['--d' as string]: '380ms' }}>
              Members, renewals, payments and every rupee collected — on the phone, tablet or laptop you already have.
            </p>
            <div className="row rise" style={{ ['--d' as string]: '480ms' }}>
              <Link className="btn primary on-dark lg" to="/login?mode=signup">Start 30-day free trial</Link>
              <Link className="btn on-dark lg" to="/login">Sign in</Link>
            </div>
            <p className="lp-fine rise" style={{ ['--d' as string]: '560ms' }}>Every feature included in the trial. No card needed.</p>
          </div>
          <div className="lp-hero-device rise-up" style={{ ['--d' as string]: '200ms' }}>
            <LiveDesk />
          </div>
        </div>
      </section>

      <section id="desk" className="lp-section">
        <div className="lp-wrap">
          <Reveal className="lp-head">
            <h2>Check someone in before they reach the counter.</h2>
            <p>The busiest moment of the day takes three steps.</p>
          </Reveal>
          <ol className="steps">
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.title} className="step" delay={i * 120}>
                <div className="step-ui">{s.ui}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section id="money" className="lp-section dark">
        <div className="lp-wrap split">
          <Reveal className="lp-head">
            <h2>Every rupee adds up. To the paisa.</h2>
            <p>What a member owes is worked out from what they were charged and what they paid. Nobody types a balance, so it can’t drift.</p>
            <ul className="ticks">
              <li><Check size={18} /> Payments are never edited — a mistake is reversed, with a reason</li>
              <li><Check size={18} /> Double-tap the pay button and it still records once</li>
              <li><Check size={18} /> Cash and UPI totalled separately for closing the day</li>
            </ul>
          </Reveal>
          <Reveal delay={120}><Ledger /></Reveal>
        </div>
      </section>

      <section className="lp-section">
        <div className="lp-wrap">
          <Reveal className="lp-head">
            <h2>Everyone signs in as themselves.</h2>
            <p>Reception can take a payment. Only you can reverse it.</p>
          </Reveal>
          <Reveal className="matrix-wrap" delay={100}>
            <table className="matrix">
              <thead><tr><th />{ROLES.map((r) => <th key={r}>{r}</th>)}</tr></thead>
              <tbody>
                {MATRIX.map(([what, allowed]) => (
                  <tr key={what}>
                    <td>{what}</td>
                    {allowed.map((ok, i) => (
                      <td key={i} aria-label={ok ? 'Allowed' : 'Not allowed'}>{ok ? <Check size={18} className="yes" /> : <Minus size={18} className="no" />}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>
        </div>
      </section>

      <section className="lp-section tint">
        <div className="lp-wrap">
          <Reveal className="lp-head center">
            <h2>Built for the counter, the floor and the office.</h2>
          </Reveal>
          <div className="devices">
            {[
              { icon: Smartphone, t: 'Phone', d: 'A real app feel: tab bar, swipe-down sheets, add to home screen.' },
              { icon: Tablet, t: 'Tablet', d: 'The front-desk screen. Big targets, a slim rail, fast renewals.' },
              { icon: Laptop, t: 'Laptop', d: 'Reports, dues lists and CSV exports at the owner’s desk.' },
            ].map((d, i) => (
              <Reveal key={d.t} className="device-card" delay={i * 110}>
                <d.icon size={28} strokeWidth={1.6} />
                <h3>{d.t}</h3>
                <p>{d.d}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="lp-section">
        <div className="lp-wrap">
          <Reveal className="lp-head">
            <h2>Everything a gym runs on, nothing it doesn’t.</h2>
          </Reveal>
          <dl className="features">
            {FEATURES.map(([t, d], i) => (
              <Reveal key={t} className="feature" delay={(i % 2) * 80}>
                <dt>{t}</dt><dd>{d}</dd>
              </Reveal>
            ))}
          </dl>
        </div>
      </section>

      <section id="faq" className="lp-section">
        <div className="lp-wrap narrow">
          <Reveal className="lp-head"><h2>Questions owners ask</h2></Reveal>
          <Reveal delay={80}><Faq /></Reveal>
        </div>
      </section>

      <section className="lp-section dark cta">
        <div className="lp-wrap">
          <Reveal className="cta-in">
            <h2>Try it on tomorrow morning’s rush.</h2>
            <p>30 days, every feature, your own data.</p>
            <Link className="btn primary on-dark lg" to="/login?mode=signup">Start free trial</Link>
          </Reveal>
        </div>
      </section>


      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <Logo width={110} />
          <span>XS Gym by Xelorsoft</span>
          <span>© 2026 Xelorsoft</span>
        </div>
      </footer>
    </div>
  );
}
