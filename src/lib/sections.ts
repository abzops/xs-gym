import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { addDays, todayInGym } from './dates';
import { membersQuery, plansQuery } from '../features/members/api';
import { rpc, supabase } from './supabase';
import type { Expense, Gym, Payment, StaffRow } from './types';

/**
 * The first query each section runs, shared by the page and by the shell's
 * prefetch, so switching sections shows data that is already in the cache.
 */
/** Start of a gym-local day as an absolute timestamp (IST is a fixed +05:30). */
const dayStart = (day: string) => `${day}T00:00:00+05:30`;

export const paymentsDayQuery = (gymId: string, day: string) => queryOptions({
  queryKey: ['payments', gymId, day],
  queryFn: async () => {
    const { data, error } = await supabase.from('payments')
      .select('*, members(full_name, member_no), payment_reversals(id, reason, reversed_at)')
      .eq('gym_id', gymId).gte('received_at', dayStart(day)).lt('received_at', dayStart(addDays(day, 1)))
      .order('received_at', { ascending: false });
    if (error) throw error;
    return data as Payment[];
  },
});

export const expensesMonthQuery = (gymId: string, period: string) => queryOptions({
  queryKey: ['expenses', gymId, period],
  queryFn: async () => {
    const [y, m] = period.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const { data, error } = await supabase.from('expenses')
      .select('*, expense_categories(name), expense_reversals(id, reason)')
      .eq('gym_id', gymId).gte('expense_date', `${period}-01`).lt('expense_date', next)
      .order('expense_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    return data as Expense[];
  },
});

export const dailyReportQuery = <T>(gymId: string, from: string, to: string) => queryOptions({
  queryKey: ['daily-report', gymId, from, to],
  queryFn: () => rpc<T[]>('daily_report', { p_gym: gymId, p_from: from, p_to: to }),
});

export const staffQuery = (gymId: string) => queryOptions({
  queryKey: ['staff', gymId],
  queryFn: async () => {
    const { data, error } = await supabase.from('gym_staff').select('*').eq('gym_id', gymId).order('role').order('created_at');
    if (error) throw error;
    return data as StaffRow[];
  },
});

// Page code, loaded on demand; preloading makes the first visit instant too.
export const pageModules = {
  expenses: () => import('../features/expenses/ExpensesPage'),
  payments: () => import('../features/payments/PaymentsPage'),
  plans: () => import('../features/plans/PlansPage'),
  reports: () => import('../features/reports/ReportsPage'),
  receipt: () => import('../features/payments/ReceiptPage'),
  import: () => import('../features/members/ImportPage'),
  settings: () => import('../features/settings/SettingsPage'),
};

type Section = '' | 'check-in' | 'members' | 'payments' | 'plans' | 'expenses' | 'reports' | 'settings';

/** Warms code and data for one section. Cheap when already fresh (staleTime). */
export function prefetchSection(qc: QueryClient, gym: Gym, section: string) {
  const today = todayInGym(gym.timezone);
  switch (section as Section) {
    case 'members': return qc.prefetchQuery(membersQuery(gym.id, '', 'all', gym.timezone));
    case 'payments': pageModules.payments(); return qc.prefetchQuery(paymentsDayQuery(gym.id, today));
    case 'plans': pageModules.plans(); return qc.prefetchQuery(plansQuery(gym.id, true));
    case 'expenses': pageModules.expenses(); return qc.prefetchQuery(expensesMonthQuery(gym.id, today.slice(0, 7)));
    case 'reports': pageModules.reports(); return qc.prefetchQuery(dailyReportQuery(gym.id, `${today.slice(0, 7)}-01`, today));
    case 'settings': pageModules.settings(); return qc.prefetchQuery(staffQuery(gym.id));
    default: return undefined;
  }
}
