import { dailyReportQuery } from '../../lib/sections';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { Field, Loading, Notice, Segmented } from '../../components/ui';
import { csvAmount, downloadCSV } from '../../lib/csv';
import { addDays, formatDate, todayInGym } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { useMembers } from '../members/api';

type Day = {
  day: string; collections_paise: number; reversals_paise: number; cash_paise: number; upi_paise: number;
  other_paise: number; expenses_paise: number; checkins: number; new_members: number;
};

type Tab = 'daily' | 'dues' | 'expiring';

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('daily');
  return (
    <div className="stack lg">
      <div className="page-head"><h1>Reports</h1></div>
      <Segmented label="Report" value={tab} onChange={setTab}
        options={[{ value: 'daily', label: 'Daily summary' }, { value: 'dues', label: 'Dues' }, { value: 'expiring', label: 'Expiring' }]} />
      {tab === 'daily' && <DailyReport />}
      {tab === 'dues' && <MemberReport kind="dues" />}
      {tab === 'expiring' && <MemberReport kind="expiring" />}
    </div>
  );
}

function DailyReport() {
  const { gym } = useGym();
  const today = todayInGym(gym.timezone);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const report = useQuery(dailyReportQuery<Day>(gym.id, from, to));
  const rows = report.data ?? [];
  const sum = (k: keyof Day) => rows.reduce((s, r) => s + Number(r[k]), 0);

  function exportCSV() {
    downloadCSV(`xs-gym-daily-${from}-to-${to}.csv`,
      ['Date', 'Collected', 'Reversed', 'Net', 'Cash', 'UPI', 'Card/bank/other', 'Expenses', 'Check-ins', 'New members'],
      rows.map((r) => [r.day, csvAmount(r.collections_paise), csvAmount(r.reversals_paise), csvAmount(r.collections_paise - r.reversals_paise),
        csvAmount(r.cash_paise), csvAmount(r.upi_paise), csvAmount(r.other_paise), csvAmount(r.expenses_paise), r.checkins, r.new_members]));
  }

  return (
    <div className="stack lg">
      <div className="row" style={{ alignItems: 'end' }}>
        <Field label="From"><input className="input" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        <button className="btn small" onClick={() => { setFrom(addDays(today, -6)); setTo(today); }}>Last 7 days</button>
        <button className="btn" onClick={exportCSV} disabled={!rows.length}><Download size={18} /> CSV</button>
      </div>
      {report.isPending ? <Loading /> : report.error ? <Notice tone="bad">{errorMessage(report.error)}</Notice> : (
        <>
          <div className="tiles">
            <div className="tile"><span className="label">Net collected</span><span className="value">{formatINR(sum('collections_paise') - sum('reversals_paise'))}</span>
              <span className="sub">{formatINR(sum('reversals_paise'))} reversed</span></div>
            <div className="tile"><span className="label">Expenses</span><span className="value">{formatINR(sum('expenses_paise'))}</span></div>
            <div className="tile"><span className="label">Collected − expenses</span>
              <span className="value">{formatINR(sum('collections_paise') - sum('reversals_paise') - sum('expenses_paise'))}</span></div>
            <div className="tile"><span className="label">Check-ins</span><span className="value">{sum('checkins')}</span><span className="sub">{sum('new_members')} new members</span></div>
          </div>
          <div className="card flush table-wrap">
            <table className="data">
              <thead><tr><th>Date</th><th className="r">Collected</th><th className="r">Reversed</th><th className="r">Cash</th><th className="r">UPI</th>
                <th className="r">Other</th><th className="r">Expenses</th><th className="r">Visits</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day}>
                    <td>{formatDate(r.day)}</td>
                    <td className="r num">{formatINR(r.collections_paise)}</td>
                    <td className="r num">{r.reversals_paise ? formatINR(r.reversals_paise) : '—'}</td>
                    <td className="r num">{formatINR(r.cash_paise)}</td>
                    <td className="r num">{formatINR(r.upi_paise)}</td>
                    <td className="r num">{formatINR(r.other_paise)}</td>
                    <td className="r num">{formatINR(r.expenses_paise)}</td>
                    <td className="r num">{r.checkins}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total</td><td className="r num">{formatINR(sum('collections_paise'))}</td><td className="r num">{formatINR(sum('reversals_paise'))}</td>
                <td className="r num">{formatINR(sum('cash_paise'))}</td><td className="r num">{formatINR(sum('upi_paise'))}</td><td className="r num">{formatINR(sum('other_paise'))}</td>
                <td className="r num">{formatINR(sum('expenses_paise'))}</td><td className="r num">{sum('checkins')}</td></tr></tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MemberReport({ kind }: { kind: 'dues' | 'expiring' }) {
  const { gym, can } = useGym();
  const members = useMembers(gym.id, '', kind, gym.timezone);
  const base = `/g/${gym.slug}`;
  const rows = members.data ?? [];

  function exportCSV() {
    downloadCSV(`xs-gym-${kind}-${todayInGym(gym.timezone)}.csv`,
      ['Member no', 'Name', 'Phone', 'Plan', 'Valid until', 'Status', 'Due'],
      rows.map((m) => [m.member_no, m.full_name, m.phone, m.plan_name ?? '', m.valid_until ?? '', m.membership_status, csvAmount(m.due_paise)]));
  }

  if (members.isPending) return <Loading />;
  if (members.error) return <Notice tone="bad">{errorMessage(members.error)}</Notice>;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted">{kind === 'dues' ? `${rows.length} members owe ${formatINR(rows.reduce((s, m) => s + m.due_paise, 0))}` : `${rows.length} memberships end in the next 7 days`}</p>
        {can('members.export') && <button className="btn" onClick={exportCSV} disabled={!rows.length}><Download size={18} /> CSV</button>}
      </div>
      <div className="card flush table-wrap">
        <table className="data">
          <thead><tr><th>Member</th><th>Phone</th><th>Plan</th><th>Valid until</th><th className="r">Due</th></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><Link to={`${base}/members/${m.id}`}>{m.full_name}</Link> <span className="mono muted">{m.member_no}</span></td>
                <td><a href={`tel:${m.phone}`}>{m.phone}</a></td>
                <td>{m.plan_name ?? '—'}</td>
                <td>{formatDate(m.valid_until)}</td>
                <td className="r num">{m.due_paise ? formatINR(m.due_paise) : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
