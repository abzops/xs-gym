import { useQuery } from '@tanstack/react-query';
import { Plus, Receipt, ScanLine, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Loading, Notice } from '../../components/ui';
import { formatDate, formatTime } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { rpc, supabase } from '../../lib/supabase';
import type { Attendance } from '../../lib/types';

type Summary = {
  today: string; timezone: string; active_members: number; in_grace: number; expiring_today: number;
  expiring_7_days: number; expiring_30_days: number; expired_last_30_days: number; new_members_month: number;
  checkins_today: number;
  financial: null | {
    collections_today: number; collections_month: number; cash_today: number; upi_today: number; other_today: number;
    reversals_today: number; reversals_month: number; expenses_today: number; expenses_month: number;
    dues_total: number; members_with_dues: number;
  };
};

export function Dashboard() {
  const { gym, can } = useGym();
  const base = `/g/${gym.slug}`;
  const summary = useQuery({
    queryKey: ['dashboard', gym.id],
    queryFn: () => rpc<Summary>('dashboard_summary', { p_gym: gym.id }),
    refetchInterval: 60_000,
  });
  const recent = useQuery({
    queryKey: ['checkins', gym.id, 'recent'],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance_events')
        .select('id, checked_in_at, member_id, voided_at, members(full_name, member_no)')
        .eq('gym_id', gym.id).is('voided_at', null).order('checked_in_at', { ascending: false }).limit(8);
      if (error) throw error;
      return data as unknown as Attendance[];
    },
  });

  if (summary.isPending) return <Loading rows={6} />;
  if (summary.error) return <Notice tone="bad">{errorMessage(summary.error)}</Notice>;
  const s = summary.data;
  const f = s.financial;

  return (
    <div className="stack lg">
      <div className="page-head">
        <h1>Today</h1>
        <span className="label">{formatDate(s.today)} · IST</span>
      </div>

      <div className="quick">
        {can('attendance.checkin') && <Link className="btn primary" to={`${base}/check-in`}><ScanLine size={20} /> Check in</Link>}
        {can('members.write') && <Link className="btn" to={`${base}/members/new`}><Plus size={20} /> Add member</Link>}
        {can('members.read') && <Link className="btn" to={`${base}/members`}><Users size={20} /> Find member</Link>}
        {can('expenses.record') && <Link className="btn" to={`${base}/expenses?new=1`}><Receipt size={20} /> Add expense</Link>}
      </div>

      <div className="tiles">
        <Link className="tile" to={`${base}/members?filter=active`}>
          <span className="label">Active members</span>
          <span className="value">{s.active_members}</span>
          <span className="sub">{s.in_grace > 0 ? `${s.in_grace} in grace period` : `${s.new_members_month} new this month`}</span>
        </Link>
        <Link className="tile" to={`${base}/check-in`}>
          <span className="label">Check-ins today</span>
          <span className="value">{s.checkins_today}</span>
          <span className="sub">Server time, IST</span>
        </Link>
        <Link className="tile" to={`${base}/members?filter=expiring`}>
          <span className="label">Expiring in 7 days</span>
          <span className="value">{s.expiring_7_days}</span>
          <span className="sub">{s.expiring_today} today · {s.expiring_30_days} in 30 days</span>
        </Link>
        <Link className="tile" to={`${base}/members?filter=expired`}>
          <span className="label">Expired (30 days)</span>
          <span className="value">{s.expired_last_30_days}</span>
          <span className="sub">Follow up to renew</span>
        </Link>
      </div>

      {f && (
        <div className="tiles">
          <Link className="tile" to={`${base}/payments`}>
            <span className="label">Collected today</span>
            <span className="value">{formatINR(f.collections_today)}</span>
            <span className="sub">Cash {formatINR(f.cash_today)} · UPI {formatINR(f.upi_today)}{f.other_today ? ` · Other ${formatINR(f.other_today)}` : ''}</span>
          </Link>
          <Link className="tile" to={`${base}/reports`}>
            <span className="label">This month</span>
            <span className="value">{formatINR(f.collections_month - f.reversals_month)}</span>
            <span className="sub">Net of {formatINR(f.reversals_month)} reversed</span>
          </Link>
          <Link className="tile" to={`${base}/members?filter=dues`}>
            <span className="label">Outstanding dues</span>
            <span className="value" style={{ color: f.dues_total > 0 ? 'var(--bad)' : undefined }}>{formatINR(f.dues_total)}</span>
            <span className="sub">{f.members_with_dues} member{f.members_with_dues === 1 ? '' : 's'}</span>
          </Link>
          <Link className="tile" to={`${base}/expenses`}>
            <span className="label">Expenses</span>
            <span className="value">{formatINR(f.expenses_today)}</span>
            <span className="sub">{formatINR(f.expenses_month)} this month</span>
          </Link>
        </div>
      )}
      {f && f.reversals_today > 0 && <Notice tone="warn">{formatINR(f.reversals_today)} was reversed today. Collected today is shown before reversals.</Notice>}

      {can('members.read') && (
        <section className="card flush">
          <div className="card-head" style={{ padding: '16px 16px 0' }}><h2>Latest check-ins</h2></div>
          {recent.data && recent.data.length === 0 ? <Empty title="No check-ins yet" /> : (
            <ul className="list">
              {recent.data?.map((a) => (
                <li key={a.id}>
                  <Link className="item" to={`${base}/members/${a.member_id}`}>
                    <span className="main-col">
                      <span className="title">{a.members?.full_name}</span>
                      <span className="meta">{a.members?.member_no}</span>
                    </span>
                    <span className="mono muted">{formatTime(a.checked_in_at, gym.timezone)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
