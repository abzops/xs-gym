import { useQuery } from '@tanstack/react-query';
import { Plus, Receipt, ScanLine, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Loading, Notice, initials } from '../../components/ui';
import { formatTime } from '../../lib/dates';
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
  const day = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${s.today}T12:00:00Z`));

  return (
    <div className="stack xl">
      <section className="today" aria-label="Today">
        <div className="when">
          <h1>{day}</h1>
          <span>India Standard Time</span>
        </div>
        <div className="figures">
          {f ? (
            <Link className="figure lead" to={`${base}/payments`}>
              <span className="value">{formatINR(f.collections_today)}</span>
              <span>Collected today{f.collections_today ? `, cash ${formatINR(f.cash_today)} and UPI ${formatINR(f.upi_today)}` : ''}</span>
            </Link>
          ) : (
            <Link className="figure lead" to={`${base}/check-in`}>
              <span className="value">{s.checkins_today}</span><span>Check-ins today</span>
            </Link>
          )}
          {f && (
            <Link className="figure" to={`${base}/check-in`}>
              <span className="value">{s.checkins_today}</span><span>Check-ins</span>
            </Link>
          )}
          <Link className="figure" to={`${base}/members?filter=active`}>
            <span className="value">{s.active_members}</span><span>Active members</span>
          </Link>
          <Link className="figure" to={`${base}/members?filter=expiring`}>
            <span className="value">{s.expiring_today}</span><span>Expire today</span>
          </Link>
        </div>
        <div className="actions">
          {can('attendance.checkin') && <Link className="btn primary" to={`${base}/check-in`}><ScanLine size={18} /> Check in</Link>}
          {can('members.write') && <Link className="btn" to={`${base}/members/new`}><Plus size={18} /> Add member</Link>}
          {can('members.read') && <Link className="btn" to={`${base}/members`}><Users size={18} /> Find member</Link>}
          {can('expenses.record') && <Link className="btn" to={`${base}/expenses?new=1`}><Receipt size={18} /> Add expense</Link>}
        </div>
      </section>

      <section className="stack">
        <h2>Needs attention</h2>
        <div className="tiles">
          <Link className="tile" to={`${base}/members?filter=expiring`}>
            <span className="label">Expiring in 7 days</span>
            <span className="value">{s.expiring_7_days}</span>
            <span className="sub">{s.expiring_30_days} within 30 days</span>
          </Link>
          <Link className="tile" to={`${base}/members?filter=expired`}>
            <span className="label">Recently expired</span>
            <span className="value">{s.expired_last_30_days}</span>
            <span className="sub">{s.in_grace} in grace period now</span>
          </Link>
          {f ? (
            <Link className="tile" to={`${base}/members?filter=dues`}>
              <span className="label">Outstanding dues</span>
              <span className="value" style={{ color: f.dues_total > 0 ? 'var(--bad)' : undefined }}>{formatINR(f.dues_total)}</span>
              <span className="sub">{f.members_with_dues} member{f.members_with_dues === 1 ? '' : 's'}</span>
            </Link>
          ) : (
            <div className="tile"><span className="label">New this month</span><span className="value">{s.new_members_month}</span></div>
          )}
          {f ? (
            <Link className="tile" to={`${base}/reports`}>
              <span className="label">This month, net</span>
              <span className="value">{formatINR(f.collections_month - f.reversals_month)}</span>
              <span className="sub">{formatINR(f.expenses_month)} spent</span>
            </Link>
          ) : (
            <div className="tile"><span className="label">In grace period</span><span className="value">{s.in_grace}</span></div>
          )}
        </div>
        {f && f.reversals_today > 0 && <Notice tone="warn">{formatINR(f.reversals_today)} was reversed today. "Collected today" counts payments before reversals.</Notice>}
      </section>

      {can('members.read') && (
        <section className="card flush">
          <div className="card-head">
            <h2>Latest check-ins</h2>
            <Link to={`${base}/check-in`}>Check someone in</Link>
          </div>
          {recent.data && recent.data.length === 0 ? <Empty title="No check-ins yet">The first visit of the day shows up here.</Empty> : (
            <ul className="list">
              {recent.data?.map((a) => (
                <li key={a.id}>
                  <Link className="item" to={`${base}/members/${a.member_id}`}>
                    <span className="avatar" aria-hidden>{initials(a.members?.full_name ?? '?')}</span>
                    <span className="main-col">
                      <span className="title">{a.members?.full_name}</span>
                      <span className="meta"><span className="mono">{a.members?.member_no}</span></span>
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
