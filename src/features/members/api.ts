import { queryOptions, useQuery } from '@tanstack/react-query';
import { addDays, todayInGym } from '../../lib/dates';
import { supabase } from '../../lib/supabase';
import type { Attendance, Charge, MemberOverview, Membership, Payment, Plan } from '../../lib/types';

export type MemberFilter = 'all' | 'active' | 'expiring' | 'expired' | 'dues' | 'archived';

/** Strips characters that would break a PostgREST `or` filter. */
function safeTerm(q: string) {
  return q.replace(/[,()%*\\:]/g, ' ').trim();
}

export function useMembers(gymId: string, search: string, filter: MemberFilter, timezone: string) {
  return useQuery(membersQuery(gymId, search, filter, timezone));
}

export const membersQuery = (gymId: string, search: string, filter: MemberFilter, timezone: string) => queryOptions({
    queryKey: ['members', gymId, search, filter],
    queryFn: async () => {
      let q = supabase.from('member_overview').select('*').eq('gym_id', gymId);
      const term = safeTerm(search);
      if (term) {
        const digits = term.replace(/\D/g, '');
        const parts = [`full_name.ilike.%${term}%`, `member_no.ilike.%${term}%`];
        if (digits.length >= 3) parts.push(`phone.ilike.%${digits}%`);
        q = q.or(parts.join(','));
      }
      const today = todayInGym(timezone);
      if (filter === 'archived') q = q.eq('status', 'archived');
      else q = q.eq('status', 'active');
      if (filter === 'active') q = q.in('membership_status', ['active', 'grace']);
      if (filter === 'expiring') q = q.gte('valid_until', today).lte('valid_until', addDays(today, 6));
      if (filter === 'expired') q = q.in('membership_status', ['expired', 'none']);
      if (filter === 'dues') q = q.gt('due_paise', 0);
      const order = filter === 'expiring' ? 'valid_until' : filter === 'dues' ? 'due_paise' : 'full_name';
      const { data, error } = await q.order(order, { ascending: filter !== 'dues' }).limit(100);
      if (error) throw error;
      return data as MemberOverview[];
    },
});

export function useMember(gymId: string, memberId: string) {
  return useQuery({
    queryKey: ['member', gymId, memberId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_overview').select('*').eq('gym_id', gymId).eq('id', memberId).maybeSingle();
      if (error) throw error;
      return data as MemberOverview | null;
    },
  });
}

export function useMemberHistory(gymId: string, memberId: string, canSeeMoney: boolean) {
  return useQuery({
    queryKey: ['member-history', gymId, memberId, canSeeMoney],
    queryFn: async () => {
      const memberships = supabase.from('member_memberships').select('*').eq('gym_id', gymId).eq('member_id', memberId)
        .order('start_date', { ascending: false }).limit(24);
      const attendance = supabase.from('attendance_events').select('*').eq('gym_id', gymId).eq('member_id', memberId)
        .order('checked_in_at', { ascending: false }).limit(20);
      const payments = canSeeMoney
        ? supabase.from('payments').select('*, payment_reversals(id, reason, reversed_at)').eq('gym_id', gymId).eq('member_id', memberId)
            .order('received_at', { ascending: false }).limit(50)
        : null;
      const charges = canSeeMoney
        ? supabase.from('charges').select('*').eq('gym_id', gymId).eq('member_id', memberId).order('created_at', { ascending: false }).limit(50)
        : null;
      const [m, a, p, c] = await Promise.all([memberships, attendance, payments, charges]);
      for (const r of [m, a, p, c]) if (r?.error) throw r.error;
      return {
        memberships: (m.data ?? []) as Membership[],
        attendance: (a.data ?? []) as Attendance[],
        payments: (p?.data ?? []) as Payment[],
        charges: (c?.data ?? []) as Charge[],
      };
    },
  });
}

export function usePlans(gymId: string, includeArchived = false) {
  return useQuery(plansQuery(gymId, includeArchived));
}

export const plansQuery = (gymId: string, includeArchived = false) => queryOptions({
    queryKey: ['plans', gymId, includeArchived],
    queryFn: async () => {
      let q = supabase.from('membership_plans').select('*').eq('gym_id', gymId);
      if (!includeArchived) q = q.eq('status', 'active');
      const { data, error } = await q.order('status').order('duration_unit', { ascending: false }).order('duration_count').order('price_paise');
      if (error) throw error;
      return data as Plan[];
    },
});

export function planDuration(p: Pick<Plan, 'duration_unit' | 'duration_count'>) {
  const n = p.duration_count;
  if (p.duration_unit === 'day') return `${n} day${n === 1 ? '' : 's'}`;
  if (n === 12) return '1 year';
  return `${n} month${n === 1 ? '' : 's'}`;
}
