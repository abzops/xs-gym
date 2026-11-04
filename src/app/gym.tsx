import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Gym, Role, StaffRow, Subscription } from '../lib/types';
import { useAuth } from './auth';

export type GymContextValue = {
  gym: Gym;
  role: Role;
  subscription: Subscription | null;
  canWrite: boolean;
  /** UI hint only — the database enforces every permission. */
  can: (permission: string) => boolean;
};

const GymContext = createContext<GymContextValue | null>(null);

export function useGym(): GymContextValue {
  const value = useContext(GymContext);
  if (!value) throw new Error('useGym must be used inside a gym route');
  return value;
}

export function GymProvider({ value, children }: { value: GymContextValue; children: ReactNode }) {
  return <GymContext.Provider value={value}>{children}</GymContext.Provider>;
}

/** Gyms the signed-in user works at. */
export function useMyGyms() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['my-gyms', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gym_staff')
        .select('role, status, gyms!inner(id, name, slug)')
        .eq('user_id', session!.user.id)
        .eq('status', 'active');
      if (error) throw error;
      return (data ?? []) as unknown as Array<Pick<StaffRow, 'role' | 'status'> & { gyms: Pick<Gym, 'id' | 'name' | 'slug'> }>;
    },
  });
}

/** Loads a gym by slug plus the caller's role, permissions and subscription. */
export function useGymBySlug(slug: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['gym', slug, session?.user.id],
    enabled: !!slug && !!session,
    queryFn: async (): Promise<GymContextValue | null> => {
      const { data: gym, error } = await supabase.from('gyms').select('*').eq('slug', slug!).maybeSingle();
      if (error) throw error;
      if (!gym) return null;
      const [staff, sub] = await Promise.all([
        supabase.from('gym_staff').select('role').eq('gym_id', gym.id).eq('user_id', session!.user.id).single(),
        supabase.from('gym_subscriptions').select('*').eq('gym_id', gym.id).maybeSingle(),
      ]);
      if (staff.error) throw staff.error;
      const role = staff.data.role as Role;
      const perms = await supabase.from('role_permissions').select('permission').eq('role', role);
      if (perms.error) throw perms.error;
      const set = new Set(perms.data.map((p) => p.permission as string));
      const subscription = (sub.data ?? null) as Subscription | null;
      const now = Date.now();
      const canWrite =
        gym.status === 'active' &&
        !!subscription &&
        ((subscription.status === 'trial' && !!subscription.trial_ends_at && Date.parse(subscription.trial_ends_at) > now) ||
          (subscription.status === 'active' && (!subscription.paid_until || Date.parse(subscription.paid_until) > now)));
      return { gym: gym as Gym, role, subscription, canWrite, can: (p) => set.has(p) };
    },
  });
}
