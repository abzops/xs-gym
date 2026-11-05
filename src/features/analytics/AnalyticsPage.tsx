import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useGym } from '../../app/gym';
import { Loading, Notice, Segmented } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { analyticsQuery, type Analytics } from '../../lib/sections';
import { BarList, ChartCard, ColumnChart, LineChart, ShareBar } from './charts';
import { DailyReport, MemberReport } from './reports';
import './analytics.css';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string, i: number) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 || i === 0 ? `${MONTHS[m - 1]} ’${String(y).slice(2)}` : MONTHS[m - 1];
};
const monthLong = (ym: string) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

/** ₹ in Indian short form for axes and tiles: ₹950, ₹12.5k, ₹1.2L, ₹3.4Cr. */
export function shortINR(paise: number) {
  const r = paise / 100, a = Math.abs(r), s = r < 0 ? '−' : '';
  const f = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, ''));
  if (a >= 1e7) return `${s}₹${f(a / 1e7)}Cr`;
  if (a >= 1e5) return `${s}₹${f(a / 1e5)}L`;
  if (a >= 1e3) return `${s}₹${f(a / 1e3)}k`;
  return `${s}₹${Math.round(a)}`;
}
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : null);
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank', other: 'Other' };
const SOURCE: Record<string, string> = { walk_in: 'Walk-in', phone: 'Phone', whatsapp: 'WhatsApp', instagram: 'Instagram', referral: 'Referral', website: 'Website', other: 'Other' };
const CAT = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)'];

type Range = '3' | '6' | '12';
type Tab = 'overview' | 'daily' | 'dues' | 'expiring';

export function AnalyticsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="stack lg">
      <div className="page-head"><h1>Analytics</h1></div>
      <Segmented label="View" value={tab} onChange={setTab}
        options={[{ value: 'overview', label: 'Overview' }, { value: 'daily', label: 'Daily' }, { value: 'dues', label: 'Dues' }, { value: 'expiring', label: 'Expiring' }]} />
      {tab === 'overview' && <Overview />}
      {tab === 'daily' && <DailyReport />}
      {tab === 'dues' && <MemberReport kind="dues" />}
      {tab === 'expiring' && <MemberReport kind="expiring" />}
    </div>
  );
}

function Delta({ now, before, invert = false }: { now: number; before: number; invert?: boolean }) {
  if (!before) return null;
  const d = Math.round(((now - before) / Math.abs(before)) * 100);
  if (!Number.isFinite(d) || d === 0) return <span className="delta">same as last month</span>;
  const good = invert ? d < 0 : d > 0;
  const Icon = d > 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`delta ${good ? 'good' : 'bad'}`}><Icon size={14} aria-hidden />{Math.abs(d)}% vs last month</span>;
}

function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="tile"><span className="label">{label}</span><span className="value num">{value}</span>{sub && <span className="sub">{sub}</span>}</div>;
}

function Overview() {
  const { gym } = useGym();
  const [range, setRange] = useState<Range>('6');
  const q = useQuery(analyticsQuery(gym.id, Number(range)));
  return (
    <div className="stack lg">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Segmented label="Period" value={range} onChange={setRange}
          options={[{ value: '3', label: '3 months' }, { value: '6', label: '6 months' }, { value: '12', label: '12 months' }]} />
      </div>
      {q.isPending ? <Loading rows={6} /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : <Charts a={q.data} />}
    </div>
  );
}

function Charts({ a }: { a: Analytics }) {
  const m = a.months;
  const labels = m.map((x, i) => monthLabel(x.month, i));
  const cur = m[m.length - 1], prev = m[m.length - 2];
  const total = (k: 'revenue_paise' | 'expenses_paise' | 'new_members' | 'lost_members' | 'renewals') => m.reduce((s, x) => s + x[k], 0);
  const revenue = total('revenue_paise'), expenses = total('expenses_paise');
  const profit = m.map((x) => x.revenue_paise - x.expenses_paise);
  const collected = a.collection.billed_paise - a.collection.outstanding_paise;
  const collectionRate = pct(collected, a.collection.billed_paise);
  const renewalRate = pct(a.renewal.renewed, a.renewal.ended);
  const avgActive = m.reduce((s, x) => s + x.active_members, 0) / Math.max(1, m.length);
  const churn = avgActive ? Math.round((total('lost_members') / m.length / avgActive) * 1000) / 10 : null;
  const arpm = a.members.active ? Math.round(a.last_30_revenue_paise / a.members.active) : 0;
  const dues = a.dues_aging.d0_7 + a.dues_aging.d8_30 + a.dues_aging.d31_60 + a.dues_aging.d60_plus;
  const enq = a.enquiries;
  const conversion = pct(enq.joined, enq.joined + enq.lost);
  const ruler = `${monthLong(m[0].month)} – ${monthLong(cur.month)}`;
  const moneyTable = (vals: number[][], head: string[]) => ({ head: ['Month', ...head], rows: m.map((x, i) => [monthLong(x.month), ...vals.map((v) => formatINR(v[i]))]) });

  return (
    <>
      <div className="tiles analytics-kpis">
        <Kpi label={`Revenue · ${MONTHS[Number(cur.month.slice(5)) - 1]}`} value={shortINR(cur.revenue_paise)}
          sub={prev ? <Delta now={cur.revenue_paise} before={prev.revenue_paise} /> : undefined} />
        <Kpi label={`Profit · ${MONTHS[Number(cur.month.slice(5)) - 1]}`} value={<span className={profit[profit.length - 1] < 0 ? 'neg' : ''}>{shortINR(profit[profit.length - 1])}</span>}
          sub={`${shortINR(cur.expenses_paise)} spent`} />
        <Kpi label="Active members" value={a.members.active}
          sub={prev ? <Delta now={cur.active_members} before={prev.active_members} /> : `${a.members.total} on record`} />
        <Kpi label="Revenue per member" value={shortINR(arpm)} sub="last 30 days" />
        <Kpi label="Collection rate" value={collectionRate === null ? '—' : `${collectionRate}%`} sub={`${shortINR(collected)} of ${shortINR(a.collection.billed_paise)} billed`} />
        <Kpi label="Renewal rate" value={renewalRate === null ? '—' : `${renewalRate}%`} sub={`${a.renewal.renewed} of ${a.renewal.ended} ended · 90 days`} />
        <Kpi label="Monthly churn" value={churn === null ? '—' : `${churn}%`} sub={`${total('lost_members')} lost in period`} />
        <Kpi label="Outstanding dues" value={shortINR(dues)} sub={`${a.dues_aging.members} members`} />
      </div>

      <div className="viz-cards">
        <ChartCard wide title="Revenue and expenses" headline={<><b className="num">{formatINR(revenue - expenses)}</b> profit · {ruler}</>}
          table={moneyTable([m.map((x) => x.revenue_paise), m.map((x) => x.expenses_paise), profit], ['Revenue', 'Expenses', 'Profit'])}>
          <ColumnChart label="Revenue and expenses by month" categories={labels} format={formatINR} tick={shortINR}
            series={[{ key: 'rev', label: 'Revenue', color: 'var(--viz-1)', values: m.map((x) => x.revenue_paise) },
              { key: 'exp', label: 'Expenses', color: 'var(--viz-2)', values: m.map((x) => x.expenses_paise) }]} />
        </ChartCard>

        <ChartCard title="Profit" headline={<>Revenue minus expenses, monthly</>} table={moneyTable([profit], ['Profit'])}>
          <LineChart label="Profit by month" categories={labels} format={formatINR} tick={shortINR}
            series={[{ key: 'profit', label: 'Profit', color: 'var(--viz-1)', values: profit }]} />
        </ChartCard>

        <ChartCard title="Active members" headline={<><b className="num">{cur.active_members}</b> now · {Math.round(avgActive)} average</>}
          table={{ head: ['Month', 'Active'], rows: m.map((x) => [monthLong(x.month), x.active_members]) }}>
          <LineChart label="Active members by month" categories={labels} format={String} tick={String}
            series={[{ key: 'act', label: 'Active members', color: 'var(--viz-1)', values: m.map((x) => x.active_members) }]} />
        </ChartCard>

        <ChartCard title="Joined and lost" headline={<><b className="num">{total('new_members')}</b> joined · <b className="num">{total('lost_members')}</b> lost · {total('renewals')} renewals</>}
          table={{ head: ['Month', 'Joined', 'Lost', 'Renewals'], rows: m.map((x) => [monthLong(x.month), x.new_members, x.lost_members, x.renewals]) }}>
          <ColumnChart label="Members joined and lost by month" categories={labels} format={String} tick={String}
            series={[{ key: 'new', label: 'Joined', color: 'var(--viz-1)', values: m.map((x) => x.new_members) },
              { key: 'lost', label: 'Lost', color: 'var(--viz-2)', values: m.map((x) => x.lost_members) }]} />
        </ChartCard>

        <ChartCard title="Sales by plan" headline={<>Memberships sold · {ruler}</>}
          table={{ head: ['Plan', 'Sold', 'Value'], rows: a.by_plan.map((p) => [p.plan, p.sold, formatINR(p.value_paise)]) }}>
          <BarList format={shortINR} rows={a.by_plan.map((p) => ({ label: p.plan, value: p.value_paise, note: `${p.sold} sold` }))} />
        </ChartCard>

        <ChartCard title="How members pay" headline={<>{a.by_method.reduce((s, x) => s + x.count, 0)} payments · {shortINR(a.by_method.reduce((s, x) => s + x.amount_paise, 0))}</>}
          table={{ head: ['Method', 'Payments', 'Amount'], rows: a.by_method.map((x) => [METHOD[x.method] ?? x.method, x.count, formatINR(x.amount_paise)]) }}>
          <ShareBar label="Payment methods" format={shortINR}
            parts={a.by_method.slice(0, 4).map((x, i) => ({ label: METHOD[x.method] ?? x.method, value: x.amount_paise, color: CAT[i] }))
              .concat(a.by_method.length > 4 ? [{ label: 'Other', value: a.by_method.slice(4).reduce((s, x) => s + x.amount_paise, 0), color: 'var(--viz-other)' }] : [])} />
        </ChartCard>

        <ChartCard title="Expenses by category" headline={<>{shortINR(expenses)} · {ruler}</>}
          table={{ head: ['Category', 'Amount'], rows: a.expense_by_category.map((x) => [x.category, formatINR(x.amount_paise)]) }}>
          <BarList format={shortINR} color="var(--viz-2)" rows={a.expense_by_category.map((x) => ({ label: x.category, value: x.amount_paise }))} />
        </ChartCard>

        <ChartCard title="Dues by age" headline={<><b className="num">{formatINR(dues)}</b> owed by {a.dues_aging.members} members</>}
          table={{ head: ['Overdue', 'Amount'], rows: [['Up to 7 days', formatINR(a.dues_aging.d0_7)], ['8–30 days', formatINR(a.dues_aging.d8_30)], ['31–60 days', formatINR(a.dues_aging.d31_60)], ['Over 60 days', formatINR(a.dues_aging.d60_plus)]] }}>
          <BarList format={shortINR} empty="No dues. Everyone has paid." rows={dues ? [
            { label: 'Up to 7 days', value: a.dues_aging.d0_7 }, { label: '8–30 days', value: a.dues_aging.d8_30 },
            { label: '31–60 days', value: a.dues_aging.d31_60 }, { label: 'Over 60 days', value: a.dues_aging.d60_plus }] : []} />
        </ChartCard>

        <ChartCard title="Enquiries" headline={<>{enq.total} in period · {conversion === null ? 'no closed enquiries yet' : `${conversion}% joined`}</>}
          table={{ head: ['Source', 'Enquiries'], rows: Object.entries(enq.by_source).map(([k, v]) => [SOURCE[k] ?? k, v]) }}>
          <div className="funnel">
            <span><b className="num">{enq.open}</b>Open</span><span><b className="num">{enq.joined}</b>Joined</span><span><b className="num">{enq.lost}</b>Lost</span>
          </div>
          <BarList format={String} empty="No enquiries yet. Add them from the Enquiries screen."
            rows={Object.entries(enq.by_source).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ label: SOURCE[k] ?? k, value: v }))} />
        </ChartCard>

        <ChartCard title="Members" headline={<>{a.members.total} on record · {a.members.active} active</>}
          table={{ head: ['Group', 'Members'], rows: [['Men', a.members.male], ['Women', a.members.female], ['Other', a.members.other], ['Not set', a.members.unknown]] }}>
          <ShareBar label="Members by gender" format={String} parts={[
            { label: 'Men', value: a.members.male, color: 'var(--viz-1)' }, { label: 'Women', value: a.members.female, color: 'var(--viz-2)' },
            { label: 'Other', value: a.members.other, color: 'var(--viz-3)' }, { label: 'Not set', value: a.members.unknown, color: 'var(--viz-other)' }]} />
        </ChartCard>
      </div>
    </>
  );
}
