// Settings → Subscription (/g/:slug/billing). Status, usage, plans, checkout via
// Razorpay payment link, scheduled changes, cancel/resume, billing details,
// invoices. The owner (billing.manage) acts; other staff see a summary.
// Nothing here grants access: the server confirms every payment with Razorpay.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CreditCard, Download, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Field, Loading, Notice, Sheet, useToast } from '../../components/ui';
import {
  cancelPlanChange, cancelSubscription, checkSubscriptionPayment, isComplimentary, loadBillingProfile, loadInvoices, loadPricing,
  loadSubscriptionPayments, quoteCheckout, resumeSubscription, saveBillingProfile, schedulePlanChange, startCheckout,
  STATE_LABEL, STATE_TONE, type BillingProfile, type Cycle, type PublicPlan, type SaasPayment,
} from '../../lib/billingApi';
import { csvAmount, downloadCSV } from '../../lib/csv';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import './billing.css';
import { CycleSwitch, PlanCards, taxLine } from './PlanCards';
import { statusLine } from './status';

const day = (iso: string | null | undefined) => (iso && iso !== 'infinity' ? formatDate(iso.slice(0, 10)) : '');

const PAY_STATUS: Record<SaasPayment['status'], { label: string; tone: string }> = {
  paid: { label: 'Paid', tone: 'ok' }, created: { label: 'Not finished', tone: 'warn' },
  expired: { label: 'Link expired', tone: 'neutral' }, cancelled: { label: 'Cancelled', tone: 'neutral' }, failed: { label: 'Failed', tone: 'bad' },
};

export function BillingPage() {
  const { gym, can, entitlements: ent, canWrite } = useGym();
  const owner = can('billing.manage');
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const returned = params.get('billing');
  const [cycle, setCycle] = useState<Cycle>(ent?.billing_cycle ?? 'monthly');
  const [choice, setChoice] = useState<PublicPlan | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const pricing = useQuery({ queryKey: ['public-pricing'], queryFn: loadPricing, staleTime: 5 * 60_000 });
  const payments = useQuery({ queryKey: ['saas-payments', gym.id], queryFn: () => loadSubscriptionPayments(gym.id), enabled: owner });
  const invoices = useQuery({ queryKey: ['saas-invoices', gym.id], queryFn: () => loadInvoices(gym.id), enabled: owner });
  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ['gym'] }), qc.invalidateQueries({ queryKey: ['saas-payments', gym.id] }),
      qc.invalidateQueries({ queryKey: ['saas-invoices', gym.id] })]);
  };

  // Back from Razorpay: confirm on the server, then refresh.
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkSubscriptionPayment>> | null>(null);
  const check = useMutation({
    mutationFn: (id: string) => checkSubscriptionPayment(gym.id, id),
    onSuccess: async (r) => { setResult(r); await refresh(); },
  });
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!returned || !owner || checked.current === returned) return;
    checked.current = returned;
    check.mutate(returned);
    const next = new URLSearchParams();
    next.set('billing', returned);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned, owner]);

  const resume = useMutation({ mutationFn: () => resumeSubscription(gym.id), onSuccess: async () => { await refresh(); toast('Subscription resumed'); } });
  const undoChange = useMutation({ mutationFn: () => cancelPlanChange(gym.id), onSuccess: async () => { await refresh(); toast('Scheduled change removed'); } });

  if (!ent) return <Notice tone="warn">Subscription details are not available yet.</Notice>;
  const currentPlan = pricing.data?.plans.find((p) => p.id === ent.plan_id);
  const rankOf = (id: string | null | undefined) => pricing.data?.plans.find((p) => p.id === id)?.rank ?? (id === 'launch' ? 2 : id === 'pilot' ? 4 : 0);
  const paidPeriod = !!ent.current_period_end && ['ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'].includes(ent.effective_state) && !isComplimentary(ent);
  const actionFor = (p: PublicPlan) => {
    const price = cycle === 'monthly' ? p.monthly_paise : p.annual_paise;
    if (!owner) return null;
    if (!price) return <button className="btn block" disabled>Not sold {cycle === 'monthly' ? 'monthly' : 'yearly'}</button>;
    let label = 'Choose ' + p.name;
    if (paidPeriod && ent.plan_id === p.id && ent.billing_cycle === cycle) label = 'Pay for next period';
    else if (paidPeriod && (rankOf(p.id) < rankOf(ent.plan_id) || (p.id === ent.plan_id && cycle === 'monthly' && ent.billing_cycle === 'annual'))) label = `Switch at period end`;
    else if (paidPeriod) label = `Upgrade to ${p.name}`;
    return <button className={`btn block ${p.id === 'growth' ? 'primary' : ''}`} onClick={() => setChoice(p)}>{label}</button>;
  };

  const membersPct = ent.limits.members ? Math.min(100, Math.round((ent.usage.members / ent.limits.members) * 100)) : 0;
  const staffPct = ent.limits.staff ? Math.min(100, Math.round((ent.usage.staff / ent.limits.staff) * 100)) : 0;

  return (
    <div className="stack lg" style={{ maxWidth: 1080 }}>
      <div className="page-head"><h1>Subscription</h1></div>

      <section className="sub-hero" aria-label="Current subscription">
        <span className="eyebrow">XS Gym plan</span>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>{ent.plan_name ?? 'XS Gym'}{ent.billing_cycle && paidPeriod ? <small style={{ fontWeight: 500, fontSize: '1rem' }}> · {ent.billing_cycle === 'annual' ? 'yearly' : 'monthly'}</small> : null}</h2>
          <span className={`badge ${isComplimentary(ent) ? 'ok' : STATE_TONE[ent.effective_state]}`}>{isComplimentary(ent) ? 'Complimentary' : STATE_LABEL[ent.effective_state]}</span>
        </div>
        <span className="when">{statusLine(ent)}</span>
        {ent.provisional && ent.effective_state !== 'TRIALING' && <span className="provisional-pill">Provisional plan terms</span>}
      </section>

      {returned && owner && (
        check.isPending ? <Notice>Checking your payment with Razorpay…</Notice>
        : check.isError ? <Notice tone="bad">{errorMessage(check.error)}</Notice>
        : result?.status === 'paid' && result.grants_access === false ? <Notice tone="warn">Test payment received ({result.invoice}). Test payments don’t change your plan.</Notice>
        : result?.status === 'paid' ? <Notice tone="ok">Payment received{result.invoice ? ` — ${result.invoice}` : ''}. Paid until {day(result.paid_until)}. Thank you!</Notice>
        : result?.status === 'created' ? (
          <Notice tone="warn">
            The payment is not finished yet. If you paid, it can take a minute to show.{' '}
            <button type="button" className="btn small" onClick={() => check.mutate(returned)}><RefreshCw size={14} /> Check again</button>
          </Notice>
        )
        : result ? <Notice tone="warn">That payment link has {result.status === 'expired' ? 'expired' : 'been cancelled'}. Start a new payment below.</Notice>
        : null
      )}

      {!canWrite && (
        <Notice tone="warn">
          Changes are paused, but nothing is deleted. {owner ? 'Choose a plan below to continue.' : 'Ask the gym owner to renew.'}
        </Notice>
      )}

      <section className="card stack">
        <h2>Usage</h2>
        <div className="meters">
          <div className={`meter ${membersPct >= 100 ? 'full' : membersPct >= 85 ? 'near' : ''}`}>
            <div className="label"><span>Active members</span><b>{ent.usage.members.toLocaleString('en-IN')}{ent.limits.members ? ` of ${ent.limits.members.toLocaleString('en-IN')}` : ' · no limit'}</b></div>
            <div className="bar" aria-hidden><span style={{ width: `${ent.limits.members ? membersPct : 6}%` }} /></div>
          </div>
          <div className={`meter ${staffPct >= 100 ? 'full' : staffPct >= 85 ? 'near' : ''}`}>
            <div className="label"><span>Staff logins</span><b>{ent.usage.staff}{ent.limits.staff !== null ? ` of ${ent.limits.staff}` : ' · no limit'}</b></div>
            <div className="bar" aria-hidden><span style={{ width: `${ent.limits.staff ? staffPct : 6}%` }} /></div>
          </div>
        </div>
        {ent.pending_plan_id && (
          <Notice tone="info">
            <CalendarClock size={15} /> Moving to <b>{pricing.data?.plans.find((p) => p.id === ent.pending_plan_id)?.name ?? ent.pending_plan_id}</b>
            {ent.pending_cycle ? ` (${ent.pending_cycle === 'annual' ? 'yearly' : 'monthly'})` : ''} when this period ends on {day(ent.current_period_end)}.{' '}
            {owner && <button className="btn small" onClick={() => undoChange.mutate()} disabled={undoChange.isPending}>Keep current plan</button>}
          </Notice>
        )}
      </section>

      {owner && (
        <section className="stack" aria-label="Plans">
          <div className="card-head"><h2>{paidPeriod ? 'Change or renew' : 'Choose a plan'}</h2></div>
          {pricing.isPending ? <Loading rows={4} /> : pricing.error ? <Notice tone="bad">{errorMessage(pricing.error)}</Notice> : (
            <>
              <CycleSwitch cycle={cycle} onChange={setCycle} pricing={pricing.data} />
              <PlanCards pricing={pricing.data} cycle={cycle} current={currentPlan && paidPeriod ? ent.plan_id : null} action={actionFor} />
              <p className="terms">{taxLine(pricing.data.terms)} Nothing renews by itself: each payment buys one period, and we remind you before it ends.</p>
            </>
          )}
        </section>
      )}

      {owner && <BillingDetails />}

      {owner && (
        <section className="card flush">
          <div className="card-head" style={{ padding: '16px 16px 0' }}><h2>Invoices and payments</h2></div>
          {invoices.isPending || payments.isPending ? <div style={{ padding: 16 }}><Loading rows={2} /></div> : (
            <ul className="list">
              {(invoices.data ?? []).map((i) => (
                <li key={i.id}>
                  <Link className="item" to={`/g/${gym.slug}/billing/invoice/${i.id}`}>
                    <FileText size={20} />
                    <span className="main-col">
                      <span className="title">{i.number}</span>
                      <span className="meta">{day(i.issued_at)} · {i.doc_type === 'tax_invoice' ? 'Tax invoice' : 'Receipt'}{i.mode === 'test' ? ' · Test' : ''}</span>
                    </span>
                    <span className="end-col">
                      <span className="num" style={{ fontWeight: 600 }}>{formatINR(i.total_paise)}</span>
                      {i.status !== 'paid' && <span className="badge warn">{i.status === 'refunded' ? 'Refunded' : 'Part refunded'}</span>}
                    </span>
                  </Link>
                </li>
              ))}
              {(payments.data ?? []).filter((p) => p.status !== 'paid').slice(0, 6).map((p) => (
                <li key={p.id}>
                  <div className="item">
                    <CreditCard size={20} />
                    <span className="main-col">
                      <span className="title">{formatINR(p.amount_paise)} · {p.months >= 12 ? '12 months' : `${p.months} month`}</span>
                      <span className="meta">{day(p.created_at)}{p.failure_reason ? ` · ${p.failure_reason}` : ''}</span>
                    </span>
                    <span className="end-col"><span className={`badge ${PAY_STATUS[p.status].tone}`}>{PAY_STATUS[p.status].label}</span></span>
                  </div>
                </li>
              ))}
              {!invoices.data?.length && !payments.data?.length && <li><div className="item"><span className="main-col"><span className="meta">No payments yet.</span></span></div></li>}
            </ul>
          )}
        </section>
      )}

      {owner && !canWrite && <ExportCard />}

      {owner && (
        <section className="card stack">
          <h2>Cancel or resume</h2>
          {ent.effective_state === 'CANCELED' ? (
            <>
              <p className="terms">Cancelled. You keep full access until {day(ent.cancel_effective_at)}.</p>
              <div className="row"><button className="btn primary" onClick={() => resume.mutate()} disabled={resume.isPending}>Resume subscription</button></div>
              {resume.error && <Notice tone="bad">{errorMessage(resume.error)}</Notice>}
            </>
          ) : ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD'].includes(ent.effective_state) && !isComplimentary(ent) ? (
            <>
              <p className="terms">Nothing is charged automatically, so there is nothing to stop. Cancelling stops reminders and ends access when the {ent.effective_state === 'TRIALING' ? 'trial' : 'paid period'} ends. Your data stays readable.</p>
              <div className="row"><button className="btn danger" onClick={() => setCancelling(true)}>Cancel subscription</button></div>
            </>
          ) : <p className="terms">There is nothing to cancel.</p>}
          {pricing.data && <p className="terms"><ShieldCheck size={14} /> {pricing.data.terms.payment_terms} Questions: <a href={`mailto:${pricing.data.terms.support_email}`}>{pricing.data.terms.support_email}</a></p>}
        </section>
      )}

      {!owner && <p className="terms">Only the gym owner can change or pay for the subscription.</p>}

      {choice && <CheckoutSheet plan={choice} cycle={cycle} onClose={() => setChoice(null)} onScheduled={async () => { setChoice(null); await refresh(); toast('Change scheduled'); }} />}
      {cancelling && <CancelSheet onClose={() => setCancelling(false)} onDone={async () => { setCancelling(false); await refresh(); toast('Subscription cancelled'); }} />}
    </div>
  );
}

function CheckoutSheet({ plan, cycle, onClose, onScheduled }: { plan: PublicPlan; cycle: Cycle; onClose: () => void; onScheduled: () => void }) {
  const { gym } = useGym();
  const quote = useQuery({ queryKey: ['saas-quote', gym.id, plan.id, cycle], queryFn: () => quoteCheckout(gym.id, plan.id, cycle), retry: false });
  const downgrade = !!quote.error && /smaller plan/.test((quote.error as { message?: string }).message ?? '');
  const pay = useMutation({
    mutationFn: () => {
      const back = new URL(window.location.href);
      back.search = ''; back.hash = '';
      return startCheckout(gym.id, plan.id, cycle, back.toString());
    },
    onSuccess: ({ url }) => { window.location.assign(url); },
  });
  const schedule = useMutation({ mutationFn: () => schedulePlanChange(gym.id, plan.id, cycle), onSuccess: onScheduled });
  const q = quote.data;
  return (
    <Sheet title={`${plan.name} · ${cycle === 'annual' ? 'yearly' : 'monthly'}`} onClose={onClose}>
      {quote.isPending ? <Loading rows={3} /> : downgrade ? (
        <div className="stack">
          <p>Smaller plans start when your current paid period ends, so you never lose days you paid for.</p>
          {schedule.error && <Notice tone="bad">{errorMessage(schedule.error)}</Notice>}
          <button className="btn primary block" onClick={() => schedule.mutate()} disabled={schedule.isPending}>Switch to {plan.name} at period end</button>
        </div>
      ) : quote.error ? <Notice tone="bad">{errorMessage(quote.error)}</Notice> : q && (
        <div className="stack">
          {q.provisional && <Notice tone="warn">Provisional price. Online payment opens once Xelorsoft confirms prices; until then only test payments work.</Notice>}
          <div className="quote">
            <div className="line"><span>{plan.name}, {q.months >= 12 ? '12 months' : '1 month'}</span><span>{formatINR(q.list_price_paise)}</span></div>
            {q.credit_paise > 0 && <div className="line"><span>Credit for unused days of your current plan</span><span>−{formatINR(q.credit_paise)}</span></div>}
            {q.amount_paise !== q.list_price_paise - q.credit_paise && <div className="line"><span>GST</span><span>{formatINR(q.amount_paise - (q.list_price_paise - q.credit_paise))}</span></div>}
            <div className="line total"><span>You pay now</span><span>{formatINR(q.amount_paise)}</span></div>
          </div>
          <p className="terms">
            {q.kind === 'upgrade' ? `${plan.name} starts as soon as the payment is confirmed and runs to ${day(q.period_end)}.`
              : q.kind === 'renewal' ? `Adds ${q.months >= 12 ? 'a year' : 'a month'}: ${day(q.period_start)} to ${day(q.period_end)}.`
              : Date.parse(q.period_start) > Date.now() + 60_000 ? `Your plan applies as soon as the payment is confirmed. The paid period runs ${day(q.period_start)} to ${day(q.period_end)}, so no trial days are lost.`
              : `Runs ${day(q.period_start)} to ${day(q.period_end)}.`}
            {' '}Nothing renews automatically.
          </p>
          {pay.error && <Notice tone="bad">{errorMessage(pay.error)}</Notice>}
          <button className="btn primary block" onClick={() => pay.mutate()} disabled={pay.isPending}>
            <CreditCard size={16} /> {pay.isPending ? 'Opening Razorpay…' : `Pay ${formatINR(q.amount_paise)} with Razorpay`}
          </button>
          <p className="terms" style={{ textAlign: 'center' }}>UPI, card or net banking on Razorpay’s secure page. You come back here afterwards.</p>
        </div>
      )}
    </Sheet>
  );
}

function CancelSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { gym } = useGym();
  const [reason, setReason] = useState('');
  const cancel = useMutation({ mutationFn: () => cancelSubscription(gym.id, reason), onSuccess: onDone });
  return (
    <Sheet title="Cancel subscription" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); cancel.mutate(); }}>
        <p className="terms">You keep everything until the current period ends. After that the gym is read-only; nothing is deleted, and paying again unlocks it.</p>
        <Field label="Why are you leaving? (optional)"><textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
        {cancel.error && <Notice tone="bad">{errorMessage(cancel.error)}</Notice>}
        <button className="btn danger block" disabled={cancel.isPending}>Cancel subscription</button>
      </form>
    </Sheet>
  );
}

function BillingDetails() {
  const { gym } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const profile = useQuery({ queryKey: ['saas-profile', gym.id], queryFn: () => loadBillingProfile(gym.id) });
  const [form, setForm] = useState<BillingProfile | null>(null);
  useEffect(() => {
    if (profile.data !== undefined && form === null) {
      setForm(profile.data ?? { legal_name: gym.name, gstin: '', address: gym.address ?? '', state_code: '', billing_email: '' });
    }
  }, [profile.data, form, gym.name, gym.address]);
  const save = useMutation({
    mutationFn: () => saveBillingProfile(gym.id, form!),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['saas-profile', gym.id] }); toast('Billing details saved'); },
  });
  if (!form) return null;
  const set = (k: keyof BillingProfile) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h2>Billing details</h2>
      <p className="terms">Printed on your invoices. Add a GSTIN if your business is GST-registered.</p>
      <div className="grid-2">
        <Field label="Business name"><input className="input" value={form.legal_name ?? ''} onChange={set('legal_name')} /></Field>
        <Field label="GSTIN (optional)"><input className="input" value={form.gstin ?? ''} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} maxLength={15} placeholder="32ABCDE1234F1Z5" /></Field>
      </div>
      <Field label="Address"><textarea className="input" rows={2} value={form.address ?? ''} onChange={set('address')} /></Field>
      <div className="grid-2">
        <Field label="State code" hint="Kerala is 32"><input className="input" inputMode="numeric" maxLength={2} value={form.state_code ?? ''} onChange={(e) => setForm({ ...form, state_code: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label="Billing email (optional)"><input className="input" type="email" value={form.billing_email ?? ''} onChange={set('billing_email')} /></Field>
      </div>
      {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
      <div className="row end"><button className="btn" disabled={save.isPending}>Save details</button></div>
    </form>
  );
}

/** When writes are paused the data still belongs to the gym: export it any time. */
function ExportCard() {
  const { gym } = useGym();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const [m, p] = await Promise.all([
        supabase.from('members').select('member_no,full_name,phone,email,join_date,status').eq('gym_id', gym.id).order('member_no'),
        supabase.from('payments').select('received_at,amount_paise,method,reference,members(full_name,member_no)').eq('gym_id', gym.id).order('received_at'),
      ]);
      if (m.error) throw m.error;
      if (p.error) throw p.error;
      downloadCSV(`${gym.slug}-members.csv`, ['Member no', 'Name', 'Phone', 'Email', 'Joined', 'Status'],
        m.data.map((r) => [r.member_no, r.full_name, r.phone, r.email, r.join_date, r.status]));
      downloadCSV(`${gym.slug}-payments.csv`, ['Received', 'Member no', 'Name', 'Amount (₹)', 'Method', 'Reference'],
        p.data.map((r) => { const mem = r.members as unknown as { full_name: string; member_no: string } | null;
          return [r.received_at, mem?.member_no, mem?.full_name, csvAmount(r.amount_paise), r.method, r.reference]; }));
    } finally { setBusy(false); }
  }
  return (
    <section className="card stack">
      <h2>Your data</h2>
      <p className="terms">Download your members and payments at any time, whatever the subscription status.</p>
      <div className="row"><button className="btn" onClick={run} disabled={busy}><Download size={16} /> {busy ? 'Preparing…' : 'Download CSV'}</button></div>
    </section>
  );
}
