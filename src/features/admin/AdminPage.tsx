// Xelorsoft commercial dashboard (/admin). Only platform admins (public.platform_admins)
// get data: every call is checked in the database. SaaS revenue only — gyms' own
// member payments are never read here.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, LogOut, RefreshCw } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Empty, Field, Loading, Logo, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import {
  adminActivateVersion, adminAudit, adminEndComplimentary, adminExport, adminExtendTrial, adminGrantComplimentary, adminGymBilling,
  adminOverview, adminPlanVersions, adminReconcile, adminRecordRefund, adminRole, adminSavePlanVersion, adminSaveCostModel,
  adminSetState, adminSettings, adminSubscriptions, adminUpdateSettings, STATE_LABEL, STATE_TONE,
  type AdminRole, type AdminSub, type Features, type PlanVersion, type SubState,
} from '../../lib/billingApi';
import { downloadCSV } from '../../lib/csv';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR, parseINR } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import '../billing/billing.css';

type Tab = 'overview' | 'customers' | 'pricing' | 'settings' | 'audit';
const day = (iso: string | null | undefined) => (!iso ? '—' : iso === 'infinity' ? 'No end' : formatDate(iso.slice(0, 10)));
/** Whole rupees for dashboard figures. */
const rs = (paise: number | null | undefined) => formatINR(Math.round(Number(paise ?? 0) / 100) * 100);
const STATES: SubState[] = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE_PERIOD', 'CANCELED', 'EXPIRED'];

export function AdminPage() {
  const role = useQuery({ queryKey: ['admin-role'], queryFn: adminRole });
  const [tab, setTab] = useState<Tab>('overview');
  if (role.isPending) return <div className="center-screen"><span className="spinner" /></div>;
  if (role.error || !role.data) {
    return <div className="center-screen"><Empty title="Not available">This page is for the Xelorsoft team.<br /><Link className="btn" to="/">Go to XS Gym</Link></Empty></div>;
  }
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div className="admin-top-in">
          <Logo onDark width={120} />
          <b>Commercial</b>
          <span className="who">{role.data}</span>
          <button className="btn small ghost on-dark" onClick={() => supabase.auth.signOut()}><LogOut size={14} /> Sign out</button>
        </div>
      </header>
      <main className="admin-main stack lg">
        <div className="admin-tabs">
          <Segmented<Tab> label="Section" value={tab} onChange={setTab} options={[
            { value: 'overview', label: 'Overview' }, { value: 'customers', label: 'Customers' }, { value: 'pricing', label: 'Pricing' },
            { value: 'settings', label: 'Settings' }, { value: 'audit', label: 'Audit' }]} />
        </div>
        {tab === 'overview' && <OverviewTab role={role.data} />}
        {tab === 'customers' && <CustomersTab role={role.data} />}
        {tab === 'pricing' && <PricingTab role={role.data} />}
        {tab === 'settings' && <SettingsTab role={role.data} />}
        {tab === 'audit' && <AuditTab />}
      </main>
    </div>
  );
}

function Kpi({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return <div className="kpi"><span className="k">{k}</span><span className="v">{v}</span>{s && <span className="s">{s}</span>}</div>;
}

function Dist({ data, labels }: { data: Record<string, number>; labels?: Record<string, string> }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div className="dist">
      {Object.entries(data).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
        <div className="r" key={k}><span>{labels?.[k] ?? k}</span><span className="bar"><span style={{ width: `${(n / max) * 100}%` }} /></span><span className="n">{n}</span></div>
      ))}
    </div>
  );
}

async function exportCsv(kind: 'subscriptions' | 'payments' | 'invoices' | 'events') {
  const rows = await adminExport(kind);
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  downloadCSV(`xs-gym-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, headers,
    rows.map((r) => headers.map((h) => (typeof r[h] === 'object' && r[h] !== null ? JSON.stringify(r[h]) : r[h]))));
}

function OverviewTab({ role }: { role: AdminRole }) {
  const qc = useQueryClient();
  const toast = useToast();
  const o = useQuery({ queryKey: ['admin-overview'], queryFn: adminOverview });
  const rec = useMutation({ mutationFn: adminReconcile, onSuccess: async (r) => { toast(`Checked ${r.checked}: ${r.applied} paid, ${r.expired} expired`); await qc.invalidateQueries({ queryKey: ['admin-overview'] }); } });
  if (o.isPending) return <Loading rows={6} />;
  if (o.error) return <Notice tone="bad">{errorMessage(o.error)}</Notice>;
  const d = o.data, m = d.metrics;
  return (
    <div className="stack lg">
      <div className="kpis">
        <Kpi k="MRR" v={rs(m.mrr_paise)} s={`${m.paying_customers} paying gym${m.paying_customers === 1 ? '' : 's'} · live money only`} />
        <Kpi k="ARR" v={rs(m.arr_paise)} s="MRR × 12" />
        <Kpi k="Collected this month" v={rs(d.collected_this_month_paise)} s={d.refunded_this_month_paise ? `${rs(d.refunded_this_month_paise)} refunded` : 'no refunds'} />
        <Kpi k="Churn (30 days)" v={m.churn_30d_pct === null ? '—' : `${m.churn_30d_pct}%`} />
        <Kpi k="Registered gyms" v={d.gyms_total} s={`${d.complimentary} complimentary / pilot`} />
        <Kpi k="Free trials" v={d.trials} s={`${d.trials_ending_7d} ending within 7 days`} />
        <Kpi k="Past due / grace" v={d.past_due} s={`${d.expired} expired`} />
        <Kpi k="Failed payments (30 d)" v={d.failed_payments_30d} s={`${d.open_disputes} open disputes · ${d.failed_webhooks} failed webhooks`} />
      </div>
      {d.test_payments_this_month > 0 && <Notice tone="info">{d.test_payments_this_month} Razorpay test payment(s) this month — not counted as revenue.</Notice>}
      <div className="grid-2">
        <section className="card stack"><h2>Plans</h2><Dist data={d.by_plan} /></section>
        <section className="card stack"><h2>Subscription states</h2><Dist data={d.by_state} labels={STATE_LABEL} /></section>
      </div>
      <section className="card stack">
        <h2>Profitability</h2>
        <div className="kpis">
          <Kpi k="Gross margin" v={m.gross_margin_pct === null ? '—' : `${m.gross_margin_pct}%`} s={`COGS ${rs(m.cogs_paise)} / month`} />
          <Kpi k="Contribution" v={rs(m.contribution_paise)} s={m.contribution_margin_pct === null ? 'after acquisition' : `${m.contribution_margin_pct}% after acquisition`} />
          <Kpi k="Break-even" v={m.break_even_customers === null ? '—' : `${m.break_even_customers} gyms`} s={`fixed costs ${rs(m.fixed_costs_paise)} / month`} />
          <Kpi k="ARPU" v={rs(m.arpu_paise)} s={`variable cost ${rs(m.variable_cost_per_customer_paise)} / gym`} />
        </div>
        <div className="defs">{Object.entries(m.definitions).map(([k, v]) => <div key={k}><b>{k.replace('_', ' ')}:</b> {v}</div>)}</div>
        <p className="terms">Costs are assumptions until a founder edits them in Settings & costs.</p>
      </section>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {role !== 'viewer' && <button className="btn" onClick={() => rec.mutate()} disabled={rec.isPending}><RefreshCw size={16} /> {rec.isPending ? 'Checking Razorpay…' : 'Reconcile with Razorpay'}</button>}
        {(['subscriptions', 'payments', 'invoices', 'events'] as const).map((k) => <button key={k} className="btn" onClick={() => void exportCsv(k)}><Download size={16} /> {k}</button>)}
      </div>
      {rec.error && <Notice tone="bad">{errorMessage(rec.error)}</Notice>}
    </div>
  );
}

function CustomersTab({ role }: { role: AdminRole }) {
  const subs = useQuery({ queryKey: ['admin-subs'], queryFn: adminSubscriptions });
  const [filter, setFilter] = useState<'all' | SubState | 'pilot'>('all');
  const [open, setOpen] = useState<AdminSub | null>(null);
  const [q, setQ] = useState('');
  const rows = useMemo(() => (subs.data ?? []).filter((s) =>
    (filter === 'all' || (filter === 'pilot' ? s.is_pilot : s.effective_state === filter)) &&
    (!q || `${s.gym} ${s.owner_email} ${s.phone}`.toLowerCase().includes(q.toLowerCase()))), [subs.data, filter, q]);
  if (subs.isPending) return <Loading rows={6} />;
  if (subs.error) return <Notice tone="bad">{errorMessage(subs.error)}</Notice>;
  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input className="input" placeholder="Search gym, email or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <select className="input" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} style={{ maxWidth: 220 }} aria-label="Filter">
          <option value="all">All states</option><option value="pilot">Pilot gyms</option>
          {STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
        </select>
      </div>
      <div className="card flush table-wrap" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead><tr><th>Gym</th><th>Owner</th><th>Plan</th><th>State</th><th>Trial / period end</th><th className="n">Members</th><th className="n">MRR</th><th className="n">Paid (live)</th></tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.gym_id} onClick={() => setOpen(s)}>
                <td><b>{s.gym}</b>{s.is_pilot && <> <span className="badge neutral">Pilot</span></>}</td>
                <td>{s.owner_email}</td>
                <td>{s.plan_id ?? '—'}{s.plan_version ? ` v${s.plan_version}` : ''}{s.cycle ? ` · ${s.cycle}` : ''}</td>
                <td><span className={`badge ${STATE_TONE[s.effective_state]}`}>{STATE_LABEL[s.effective_state]}</span></td>
                <td>{s.effective_state === 'TRIALING' ? day(s.trial_ends_at) : s.complimentary_until ? `comp: ${day(s.complimentary_until)}` : day(s.period_end)}</td>
                <td className="n">{s.members}</td>
                <td className="n">{s.mrr_paise ? formatINR(s.mrr_paise) : '—'}</td>
                <td className="n">{formatINR(s.paid_total_paise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <CustomerSheet sub={open} role={role} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CustomerSheet({ sub, role, onClose }: { sub: AdminSub; role: AdminRole; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useQuery({ queryKey: ['admin-gym', sub.gym_id], queryFn: () => adminGymBilling(sub.gym_id) });
  const [action, setAction] = useState<'trial' | 'comp' | 'endcomp' | 'state' | 'refund' | null>(null);
  const [days, setDays] = useState('14');
  const [until, setUntil] = useState('');
  const [plan, setPlan] = useState('pilot');
  const [state, setState] = useState<SubState>('ACTIVE');
  const [payment, setPayment] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const run = useMutation({
    mutationFn: async () => {
      const at = until ? new Date(`${until}T23:59:59+05:30`).toISOString() : null;
      if (action === 'trial') return adminExtendTrial(sub.gym_id, Number(days), reason);
      if (action === 'comp') return adminGrantComplimentary(sub.gym_id, at, plan, reason);
      if (action === 'endcomp') return adminEndComplimentary(sub.gym_id, at ?? new Date().toISOString(), reason);
      if (action === 'state') return adminSetState(sub.gym_id, state, reason);
      if (action === 'refund') return adminRecordRefund(payment, parseINR(amount) ?? 0, reason);
    },
    onSuccess: async () => {
      setAction(null); setReason('');
      await Promise.all(['admin-gym', 'admin-subs', 'admin-overview', 'admin-audit'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
      toast('Saved and audited');
    },
  });
  const e = detail.data?.entitlements;
  return (
    <Sheet title={sub.gym} onClose={onClose}>
      {detail.isPending ? <Loading rows={4} /> : detail.error ? <Notice tone="bad">{errorMessage(detail.error)}</Notice> : (
        <div className="stack">
          <dl className="kv">
            <dt>Owner</dt><dd>{sub.owner_email} · {sub.phone ?? 'no phone'}</dd>
            <dt>Plan</dt><dd>{e?.plan_name} v{e?.plan_version}{e?.billing_cycle ? ` · ${e.billing_cycle}` : ''}</dd>
            <dt>State</dt><dd>{e && STATE_LABEL[e.effective_state]} (stored {e?.state})</dd>
            <dt>Trial</dt><dd>{day(e?.trial_started_at)} → {day(e?.trial_ends_at)}</dd>
            <dt>Paid period</dt><dd>{day(e?.current_period_start)} → {day(e?.current_period_end)}</dd>
            <dt>Complimentary</dt><dd>{day(e?.complimentary_until)}</dd>
            <dt>Usage</dt><dd>{e?.usage.members} members · {e?.usage.staff} staff</dd>
          </dl>
          {role !== 'viewer' && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => setAction('trial')}>Extend trial</button>
              <button className="btn small" onClick={() => setAction('comp')}>Complimentary access</button>
              {e?.complimentary_until && <button className="btn small" onClick={() => setAction('endcomp')}>End complimentary</button>}
              <button className="btn small" onClick={() => setAction('state')}>Set state</button>
              <button className="btn small" onClick={() => setAction('refund')}>Record refund</button>
            </div>
          )}
          {action && (
            <form className="card stack" onSubmit={(ev) => { ev.preventDefault(); run.mutate(); }}>
              {action === 'trial' && <Field label="Extend by (days)"><input className="input" inputMode="numeric" value={days} onChange={(ev) => setDays(ev.target.value.replace(/\D/g, ''))} /></Field>}
              {(action === 'comp' || action === 'endcomp') && <Field label={action === 'comp' ? 'Until (empty = no end date)' : 'Ends on'}><input className="input" type="date" value={until} onChange={(ev) => setUntil(ev.target.value)} /></Field>}
              {action === 'comp' && <Field label="Features of plan"><select className="input" value={plan} onChange={(ev) => setPlan(ev.target.value)}>{['pilot', 'pro', 'growth', 'starter'].map((p) => <option key={p}>{p}</option>)}</select></Field>}
              {action === 'state' && <Field label="New state"><select className="input" value={state} onChange={(ev) => setState(ev.target.value as SubState)}>{STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}</select></Field>}
              {action === 'refund' && (
                <>
                  <Field label="Payment"><select className="input" value={payment} onChange={(ev) => setPayment(ev.target.value)}>
                    <option value="">Choose…</option>
                    {(detail.data?.payments ?? []).filter((p) => p.status === 'paid').map((p) => <option key={p.id} value={p.id}>{day(p.paid_at)} · {formatINR(p.amount_paise)} · {p.mode}</option>)}
                  </select></Field>
                  <Field label="Amount refunded in Razorpay (₹)" hint="This only records it; make the refund in the Razorpay dashboard."><input className="input" inputMode="decimal" value={amount} onChange={(ev) => setAmount(ev.target.value)} /></Field>
                </>
              )}
              <Field label="Reason (saved in the audit trail)"><input className="input" value={reason} onChange={(ev) => setReason(ev.target.value)} required minLength={3} /></Field>
              {run.error && <Notice tone="bad">{errorMessage(run.error)}</Notice>}
              <div className="row end"><button type="button" className="btn ghost" onClick={() => setAction(null)}>Close</button><button className="btn primary" disabled={run.isPending || reason.trim().length < 3}>Save</button></div>
            </form>
          )}
          <h3>Payments and invoices</h3>
          <ul className="list grouped">
            {(detail.data?.payments ?? []).map((p) => (
              <li key={p.id}><div className="item"><span className="main-col"><span className="title">{formatINR(p.amount_paise)} · {p.kind} · {p.billing_cycle ?? `${p.months} mo`}</span>
                <span className="meta">{day(p.created_at)} · {p.status}{p.mode === 'test' ? ' · TEST' : ''}{p.refunded_paise ? ` · refunded ${formatINR(p.refunded_paise)}` : ''}</span></span></div></li>
            ))}
            {(detail.data?.invoices ?? []).map((i) => <li key={i.id}><div className="item"><span className="main-col"><span className="title">{i.number}</span><span className="meta">{day(i.issued_at)} · {formatINR(i.total_paise)} · {i.status}</span></span></div></li>)}
          </ul>
          <h3>History</h3>
          <ul className="list grouped">
            {(detail.data?.events ?? []).slice(0, 40).map((ev) => (
              <li key={ev.id}><div className="item"><span className="main-col"><span className="title">{ev.event}{ev.to_state && ev.from_state !== ev.to_state ? ` → ${ev.to_state}` : ''}</span>
                <span className="meta">{new Date(ev.created_at).toLocaleString('en-IN')} · {ev.source}</span></span></div></li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

const FEATURE_KEYS: Array<keyof Features> = ['analytics', 'enquiries', 'xs_ai', 'priority_support'];

function PricingTab({ role }: { role: AdminRole }) {
  const qc = useQueryClient();
  const toast = useToast();
  const v = useQuery({ queryKey: ['admin-versions'], queryFn: adminPlanVersions });
  const [form, setForm] = useState<null | { plan: string; monthly: string; annual: string; trial: string; members: string; staff: string; branches: string; notes: string; features: Features }>(null);
  const [activate, setActivate] = useState<PlanVersion | null>(null);
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () => adminSavePlanVersion({
      plan: form!.plan, monthly: parseINR(form!.monthly), annual: parseINR(form!.annual), trial_days: Number(form!.trial || 30), features: form!.features,
      member_limit: form!.members ? Number(form!.members) : null, staff_limit: form!.staff ? Number(form!.staff) : null, branch_limit: Number(form!.branches || 1), notes: form!.notes,
    }),
    onSuccess: async () => { setForm(null); await qc.invalidateQueries({ queryKey: ['admin-versions'] }); toast('Draft saved — not on sale until activated'); },
  });
  const act = useMutation({
    mutationFn: () => adminActivateVersion(activate!.id, reason),
    onSuccess: async () => { setActivate(null); setReason(''); await qc.invalidateQueries({ queryKey: ['admin-versions'] }); toast('Version is now on sale'); },
  });
  if (v.isPending) return <Loading rows={6} />;
  if (v.error) return <Notice tone="bad">{errorMessage(v.error)}</Notice>;
  const edit = (p: PlanVersion) => setForm({
    plan: p.plan_id, monthly: p.monthly_price_paise ? String(p.monthly_price_paise / 100) : '', annual: p.annual_price_paise ? String(p.annual_price_paise / 100) : '',
    trial: String(p.trial_days), members: p.member_limit ? String(p.member_limit) : '', staff: p.staff_limit !== null ? String(p.staff_limit) : '',
    branches: String(p.branch_limit), notes: '', features: { ...p.features },
  });
  return (
    <div className="stack lg">
      <Notice tone="info">A price change creates a new draft version. Activating it (owners only) puts it on sale for new purchases; existing subscribers keep the version they bought.</Notice>
      <div className="card flush" style={{ overflowX: 'auto' }}>
        <table className="adm-table">
          <thead><tr><th>Plan</th><th>Version</th><th>Status</th><th className="n">Monthly</th><th className="n">Yearly</th><th>Limits</th><th>Features</th><th className="n">Subscribers</th><th /></tr></thead>
          <tbody>
            {v.data.map((p) => (
              <tr key={p.id} style={{ cursor: 'default' }}>
                <td><b>{p.plan_name}</b>{!p.is_public && <> <span className="badge neutral">hidden</span></>}</td>
                <td>v{p.version}</td>
                <td><span className={`badge ${p.status === 'active' ? 'ok' : p.status === 'draft' ? 'warn' : 'neutral'}`}>{p.status}{p.provisional ? ' · provisional' : ''}</span></td>
                <td className="n">{p.monthly_price_paise ? formatINR(p.monthly_price_paise) : '—'}</td>
                <td className="n">{p.annual_price_paise ? formatINR(p.annual_price_paise) : '—'}</td>
                <td>{p.member_limit ?? '∞'} members · {p.staff_limit ?? '∞'} staff</td>
                <td>{FEATURE_KEYS.filter((k) => p.features[k]).join(', ') || 'core'}</td>
                <td className="n">{p.subscribers}</td>
                <td>
                  {role === 'owner' && p.is_public && <button className="btn small" onClick={() => edit(p)}>New version</button>}{' '}
                  {role === 'owner' && p.status === 'draft' && <button className="btn small primary" onClick={() => setActivate(p)}>Activate</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {form && (
        <Sheet title={`New ${form.plan} version`} onClose={() => setForm(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="grid-2">
              <Field label="Monthly price (₹, incl. GST if registered)"><input className="input" inputMode="decimal" value={form.monthly} onChange={(e) => setForm({ ...form, monthly: e.target.value })} /></Field>
              <Field label="Yearly price (₹)"><input className="input" inputMode="decimal" value={form.annual} onChange={(e) => setForm({ ...form, annual: e.target.value })} /></Field>
              <Field label="Active member limit (empty = none)"><input className="input" inputMode="numeric" value={form.members} onChange={(e) => setForm({ ...form, members: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Staff logins (empty = none)"><input className="input" inputMode="numeric" value={form.staff} onChange={(e) => setForm({ ...form, staff: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Trial days"><input className="input" inputMode="numeric" value={form.trial} onChange={(e) => setForm({ ...form, trial: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Locations"><input className="input" inputMode="numeric" value={form.branches} onChange={(e) => setForm({ ...form, branches: e.target.value.replace(/\D/g, '') })} /></Field>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {FEATURE_KEYS.map((k) => (
                <label key={k} className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={!!form.features[k]} onChange={(e) => setForm({ ...form, features: { ...form.features, [k]: e.target.checked } })} /> {k}
                </label>
              ))}
            </div>
            <Field label="Why (notes)"><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
            <button className="btn primary block" disabled={save.isPending}>Save as draft</button>
          </form>
        </Sheet>
      )}
      {activate && (
        <Sheet title={`Put ${activate.plan_name} v${activate.version} on sale?`} onClose={() => setActivate(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); act.mutate(); }}>
            <p>{formatINR(activate.monthly_price_paise)} a month · {formatINR(activate.annual_price_paise)} a year. New customers pay this from now on; current subscribers keep their terms. This is a founder decision and is audited.</p>
            <Field label="Approval note"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></Field>
            {act.error && <Notice tone="bad">{errorMessage(act.error)}</Notice>}
            <button className="btn primary block" disabled={act.isPending || reason.trim().length < 3}>Activate</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}

const SETTING_FIELDS: Array<{ k: string; label: string; type: 'text' | 'number' | 'bool' | 'select'; options?: string[]; hint?: string }> = [
  { k: 'default_trial_days', label: 'Free trial days', type: 'number' },
  { k: 'trial_plan_id', label: 'Trial uses features of', type: 'select', options: ['pro', 'growth', 'starter'] },
  { k: 'past_due_days', label: 'Full access after period end (days)', type: 'number' },
  { k: 'grace_days', label: 'Then grace period (days)', type: 'number' },
  { k: 'expired_access', label: 'When expired', type: 'select', options: ['read_only', 'billing_only'] },
  { k: 'gst_status', label: 'Xelorsoft GST status', type: 'select', options: ['unconfirmed', 'registered', 'not_registered'], hint: 'Confirm with your CA before going live' },
  { k: 'gstin', label: 'GSTIN', type: 'text' },
  { k: 'gst_rate_bp', label: 'GST rate (basis points, 1800 = 18%)', type: 'number' },
  { k: 'prices_include_gst', label: 'Prices include GST', type: 'bool' },
  { k: 'sac_code', label: 'SAC code', type: 'text' },
  { k: 'legal_name', label: 'Legal name on invoices', type: 'text' },
  { k: 'supplier_address', label: 'Address on invoices', type: 'text' },
  { k: 'supplier_state_code', label: 'State code', type: 'text' },
  { k: 'support_email', label: 'Billing email', type: 'text' },
  { k: 'invoice_prefix', label: 'Invoice prefix', type: 'text' },
  { k: 'payment_terms', label: 'Payment terms (shown to customers)', type: 'text' },
  { k: 'allow_provisional_checkout', label: 'Allow TEST checkout on provisional prices', type: 'bool' },
  { k: 'test_payments_grant_access', label: 'Test payments grant access (test databases only)', type: 'bool' },
];
const COST_FIELDS: Array<{ k: string; label: string }> = [
  { k: 'fixed_infra_monthly_paise', label: 'Fixed infrastructure / month (₹)' },
  { k: 'infra_per_gym_monthly_paise', label: 'Infrastructure per gym / month (₹)' },
  { k: 'support_per_gym_monthly_paise', label: 'Support per gym / month (₹)' },
  { k: 'cac_paise', label: 'Acquisition cost per new paying gym (₹)' },
  { k: 'fixed_overhead_monthly_paise', label: 'Fixed overhead / month (₹)' },
];

function SettingsTab({ role }: { role: AdminRole }) {
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['admin-settings'], queryFn: adminSettings });
  const [patch, setPatch] = useState<Record<string, unknown>>({});
  const [cost, setCost] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState('');
  const owner = role === 'owner';
  const saveS = useMutation({ mutationFn: () => adminUpdateSettings(patch, reason), onSuccess: async () => { setPatch({}); setReason(''); await qc.invalidateQueries(); toast('Billing settings saved'); } });
  const saveC = useMutation({ mutationFn: () => adminSaveCostModel(cost, reason), onSuccess: async () => { setCost({}); setReason(''); await qc.invalidateQueries(); toast('Cost model saved'); } });
  if (s.isPending) return <Loading rows={6} />;
  if (s.error) return <Notice tone="bad">{errorMessage(s.error)}</Notice>;
  const b = { ...s.data.billing, ...patch } as Record<string, unknown>;
  const c = { ...s.data.cost_model, ...cost } as Record<string, unknown>;
  const ai = (c.ai_cost_per_gym_monthly_paise ?? {}) as Record<string, number>;
  return (
    <div className="stack lg">
      <section className="card stack">
        <h2>Billing settings</h2>
        <div className="grid-2">
          {SETTING_FIELDS.map((f) => (
            <Field key={f.k} label={f.label} hint={f.hint}>
              {f.type === 'bool' ? <input type="checkbox" disabled={!owner} checked={!!b[f.k]} onChange={(e) => setPatch({ ...patch, [f.k]: e.target.checked })} />
                : f.type === 'select' ? <select className="input" disabled={!owner} value={String(b[f.k] ?? '')} onChange={(e) => setPatch({ ...patch, [f.k]: e.target.value })}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                : <input className="input" disabled={!owner} inputMode={f.type === 'number' ? 'numeric' : undefined} value={String(b[f.k] ?? '')}
                    onChange={(e) => setPatch({ ...patch, [f.k]: f.type === 'number' ? Number(e.target.value.replace(/\D/g, '')) : (e.target.value || null) })} />}
            </Field>
          ))}
        </div>
      </section>
      <section className="card stack">
        <h2>Cost model</h2>
        <p className="terms">Used for margins and break-even on the Overview. Values are assumptions until replaced. Suggested prices are in docs/BILLING.md and are never published automatically.</p>
        <div className="grid-2">
          {COST_FIELDS.map((f) => (
            <Field key={f.k} label={f.label}>
              <input className="input" disabled={!owner} inputMode="decimal" value={String(Number(c[f.k] ?? 0) / 100)} onChange={(e) => setCost({ ...cost, [f.k]: parseINR(e.target.value) ?? 0 })} />
            </Field>
          ))}
          <Field label="Payment processing (basis points, 236 = 2.36%)">
            <input className="input" disabled={!owner} inputMode="numeric" value={String(c.gateway_fee_bp ?? '')} onChange={(e) => setCost({ ...cost, gateway_fee_bp: Number(e.target.value.replace(/\D/g, '')) })} />
          </Field>
          {['starter', 'growth', 'pro'].map((p) => (
            <Field key={p} label={`AI/API cost per ${p} gym / month (₹)`}>
              <input className="input" disabled={!owner} inputMode="decimal" value={String((ai[p] ?? 0) / 100)}
                onChange={(e) => setCost({ ...cost, ai_cost_per_gym_monthly_paise: { ...ai, [p]: parseINR(e.target.value) ?? 0 } })} />
            </Field>
          ))}
        </div>
      </section>
      {owner && (
        <section className="card stack">
          <Field label="Reason for the change (audited)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {(saveS.error || saveC.error) && <Notice tone="bad">{errorMessage(saveS.error ?? saveC.error)}</Notice>}
          <div className="row end">
            <button className="btn" disabled={!Object.keys(cost).length || reason.trim().length < 3 || saveC.isPending} onClick={() => saveC.mutate()}>Save cost model</button>
            <button className="btn primary" disabled={!Object.keys(patch).length || reason.trim().length < 3 || saveS.isPending} onClick={() => saveS.mutate()}>Save billing settings</button>
          </div>
        </section>
      )}
    </div>
  );
}

function AuditTab() {
  const a = useQuery({ queryKey: ['admin-audit'], queryFn: () => adminAudit(300) });
  if (a.isPending) return <Loading rows={6} />;
  if (a.error) return <Notice tone="bad">{errorMessage(a.error)}</Notice>;
  if (!a.data.length) return <Empty title="No admin changes yet" />;
  return (
    <ul className="list card flush">
      {a.data.map((r) => (
        <li key={r.id}><div className="item"><span className="main-col">
          <span className="title">{r.action} · {r.target_type} {r.target_id?.slice(0, 8)}</span>
          <span className="meta">{new Date(r.created_at).toLocaleString('en-IN')} · {r.actor ?? 'system'}{r.reason ? ` · “${r.reason}”` : ''}</span>
        </span></div></li>
      ))}
    </ul>
  );
}
