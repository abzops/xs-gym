// Getting-started checklist for a new gym. Each step ticks itself off from real
// data; the card goes away when everything is done or the owner hides it.
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { daysBetween, todayInGym } from '../../lib/dates';
import { supabase } from '../../lib/supabase';

const count = async (table: string, gymId: string, extra?: (q: any) => any) => {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('gym_id', gymId);
  if (extra) q = extra(q);
  const { count: n, error } = await q;
  if (error) throw error;
  return n ?? 0;
};

export function GettingStarted() {
  const { gym, can } = useGym();
  const key = `xs-start-hidden-${gym.id}`;
  // Hidden by the owner, or finished before: never render, so nothing jumps on load.
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const young = daysBetween(gym.created_at.slice(0, 10), todayInGym(gym.timezone)) <= 45;
  const show = can('gym.settings') && young && !hidden;
  const q = useQuery({
    queryKey: ['getting-started', gym.id],
    enabled: show,
    staleTime: 60_000,
    queryFn: async () => {
      const [plans, members, sold, paid, staff] = await Promise.all([
        count('membership_plans', gym.id, (x) => x.eq('status', 'active')),
        count('members', gym.id),
        count('member_memberships', gym.id),
        count('payments', gym.id),
        count('gym_staff', gym.id),
      ]);
      return { plans, members, sold, paid, staff };
    },
  });
  const hide = () => { setHidden(true); try { localStorage.setItem(key, '1'); } catch { /* private mode */ } };
  const all = q.data && q.data.plans > 0 && q.data.members > 0 && q.data.sold > 0 && q.data.paid > 0 && q.data.staff > 1;
  useEffect(() => { if (all) { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } } }, [all, key]);
  if (!show || all || q.isError) return null;
  // While counts load, the card is drawn at full size so the page does not shift.
  const d = q.data ?? { plans: 0, members: 0, sold: 0, paid: 0, staff: 0 };
  const base = `/g/${gym.slug}`;
  const steps = [
    { done: d.plans > 0, label: 'Add the plans you sell', to: `${base}/plans` },
    { done: d.members > 0, label: 'Add or import your members', to: `${base}/members/import` },
    { done: d.sold > 0, label: 'Sell a membership', to: `${base}/members` },
    { done: d.paid > 0, label: 'Record a payment', to: `${base}/payments` },
    { done: d.staff > 1, label: 'Invite your team', to: `${base}/settings` },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <section className="start-card" aria-label="Getting started">
      <div className="start-head">
        <div><h2>Getting started</h2><p className="muted">{q.data ? `${done} of ${steps.length} done` : 'Checking…'}</p></div>
        <button type="button" className="btn small ghost" onClick={hide} aria-label="Hide getting started"><X size={16} /></button>
      </div>
      <span className="start-bar" aria-hidden><i style={{ width: `${(done / steps.length) * 100}%` }} /></span>
      <ul>
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            {s.done ? <span className="tick"><Check size={14} strokeWidth={3} /></span> : <span className="tick" />}
            {s.done ? <span>{s.label}</span> : <Link to={s.to}>{s.label}<ChevronRight size={16} aria-hidden /></Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}
