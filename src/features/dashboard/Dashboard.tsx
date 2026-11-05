import { useQuery } from '@tanstack/react-query';
import { BarChart3, CalendarClock, ChevronRight, IndianRupee, Plus, Receipt, Search, UserPlus, Users } from 'lucide-react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Loading, Notice, PushLink, initials } from '../../components/ui';
import { addDays, formatDate, todayInGym } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { rpc, supabase } from '../../lib/supabase';
import type { MemberOverview } from '../../lib/types';
import './dashboard.css';
import { GettingStarted } from './GettingStarted';

type Summary = {
  today: string; timezone: string; active_members: number; in_grace: number; expiring_today: number;
  expiring_7_days: number; expiring_30_days: number; expired_last_30_days: number; new_members_month: number;
  financial: null | {
    collections_today: number; collections_month: number; cash_today: number; upi_today: number; other_today: number;
    reversals_today: number; reversals_month: number; expenses_today: number; expenses_month: number;
    dues_total: number; members_with_dues: number;
  };
};

function greeting(timeZone: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const { gym, can } = useGym();
  const base = `/g/${gym.slug}`;
  const summary = useQuery({
    queryKey: ['dashboard', gym.id],
    queryFn: () => rpc<Summary>('dashboard_summary', { p_gym: gym.id }),
    refetchInterval: 60_000,
  });
  // Members whose plan ends in the next week: the list a front desk acts on.
  const expiring = useQuery({
    queryKey: ['members', gym.id, 'expiring-soon'],
    enabled: can('members.read'),
    queryFn: async () => {
      const today = todayInGym(gym.timezone);
      const { data, error } = await supabase.from('member_overview')
        .select('id, full_name, member_no, valid_until, due_paise')
        .eq('gym_id', gym.id).eq('status', 'active').gte('valid_until', today).lte('valid_until', addDays(today, 6))
        .order('valid_until').limit(6);
      if (error) throw error;
      return data as Pick<MemberOverview, 'id' | 'full_name' | 'member_no' | 'valid_until' | 'due_paise'>[];
    },
  });

  if (summary.isPending) return <Loading rows={6} />;
  if (summary.error) return <Notice tone="bad">{errorMessage(summary.error)}</Notice>;
  const s = summary.data;
  const f = s.financial;
  const day = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${s.today}T12:00:00Z`));
  const total = f ? f.cash_today + f.upi_today + f.other_today : 0;
  const pct = (n: number) => (total ? `${(n / total) * 100}%` : '0%');

  return (
    <div className="dash">
      <header className="dash-head">
        <p>{day}</p>
        <h1>{greeting(gym.timezone)}</h1>
      </header>

      <GettingStarted />

      <nav className="quick" aria-label="Quick actions">
        {can('members.write') && <Link className="q primary" to={`${base}/members/new`}><span className="q-ico"><Plus size={22} /></span><span>Add member</span></Link>}
        {can('members.read') && <Link className="q" to={`${base}/members`}><span className="q-ico"><Search size={21} /></span><span>Find</span></Link>}
        {can('expenses.record') && <Link className="q" to={`${base}/expenses?new=1`}><span className="q-ico"><Receipt size={21} /></span><span>Expense</span></Link>}
        {can('reports.financial') && <Link className="q" to={`${base}/analytics`}><span className="q-ico"><BarChart3 size={21} /></span><span>Analytics</span></Link>}
      </nav>

      {f ? (
        <PushLink className="hero-card" to={`${base}/payments`}>
          <span className="hc-top"><span>Collected today</span><ChevronRight size={18} /></span>
          <span className="hc-value num">{formatINR(f.collections_today)}</span>
          <span className="paybar" aria-hidden>
            <i className="s-cash" style={{ width: pct(f.cash_today) }} />
            <i className="s-upi" style={{ width: pct(f.upi_today) }} />
            <i className="s-other" style={{ width: pct(f.other_today) }} />
          </span>
          <span className="legend">
            <span><i className="s-cash" />Cash <b className="num">{formatINR(f.cash_today)}</b></span>
            <span><i className="s-upi" />UPI <b className="num">{formatINR(f.upi_today)}</b></span>
            {f.other_today > 0 && <span><i className="s-other" />Other <b className="num">{formatINR(f.other_today)}</b></span>}
          </span>
        </PushLink>
      ) : (
        <PushLink className="hero-card" to={`${base}/members?filter=active`}>
          <span className="hc-top"><span>Active members</span><ChevronRight size={18} /></span>
          <span className="hc-value num">{s.active_members}</span>
        </PushLink>
      )}

      <section className="stats" aria-label="Today at a glance">
        <PushLink className="stat" to={`${base}/members`}>
          <span className="st-label"><UserPlus size={16} />New members</span>
          <span className="st-value num">{s.new_members_month}</span>
          <span className="st-sub">this month</span>
        </PushLink>
        <PushLink className="stat" to={`${base}/members?filter=active`}>
          <span className="st-label"><Users size={16} />Active</span>
          <span className="st-value num">{s.active_members}</span>
          <span className="st-sub">{s.in_grace > 0 ? `${s.in_grace} in grace period` : 'with a running plan'}</span>
        </PushLink>
        <PushLink className="stat" to={`${base}/members?filter=expiring`}>
          <span className="st-label"><CalendarClock size={16} className={s.expiring_7_days > 0 ? 'tone-warn' : undefined} />Expiring</span>
          <span className="st-value num">{s.expiring_7_days}</span>
          <span className="st-sub">{s.expiring_today} today</span>
        </PushLink>
        {f ? (
          <PushLink className="stat" to={`${base}/members?filter=dues`}>
            <span className="st-label"><IndianRupee size={16} className={f.dues_total > 0 ? 'tone-bad' : undefined} />Dues</span>
            <span className={`st-value num ${f.dues_total > 0 ? 'due' : ''}`}>{formatINR(f.dues_total)}</span>
            <span className="st-sub">{f.members_with_dues} members</span>
          </PushLink>
        ) : (
          <PushLink className="stat" to={`${base}/members?filter=expired`}>
            <span className="st-label"><CalendarClock size={16} />Expired</span>
            <span className="st-value num">{s.expired_last_30_days}</span>
            <span className="st-sub">last 30 days</span>
          </PushLink>
        )}
      </section>

      {f && (
        <section className="month">
          <h2>This month</h2>
          <ul className="ios-list">
            <li><span>Collected</span><b className="num">{formatINR(f.collections_month)}</b></li>
            {f.reversals_month > 0 && <li><span>Reversed</span><b className="num neg">−{formatINR(f.reversals_month)}</b></li>}
            <li><span>Expenses</span><b className="num neg">−{formatINR(f.expenses_month)}</b></li>
            <li className="total"><span>Net</span><b className="num">{formatINR(f.collections_month - f.reversals_month - f.expenses_month)}</b></li>
            <li><Link to={`${base}/members?filter=expired`}><span>Recently expired</span><b className="num">{s.expired_last_30_days}</b><ChevronRight size={16} /></Link></li>
          </ul>
        </section>
      )}

      {can('members.read') && (
        <section className="recent">
          <h2>Expiring soon</h2>
          {expiring.data && expiring.data.length === 0 ? (
            <div className="ios-list"><Empty title="No plans end this week" /></div>
          ) : (
            <ul className="ios-list people">
              {expiring.data?.map((m) => (
                <li key={m.id}>
                  <PushLink to={`${base}/members/${m.id}`}>
                    <span className="avatar" aria-hidden>{initials(m.full_name)}</span>
                    <span className="who"><b>{m.full_name}</b><small>{m.member_no}{m.due_paise > 0 ? ` · ${formatINR(m.due_paise)} due` : ''}</small></span>
                    <span className="when num">{m.valid_until ? formatDate(m.valid_until) : ''}</span>
                  </PushLink>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
