// Calls the staff-login Edge Function (create a login, reset a password).
import type { Credentials } from './staffLogin';
import { supabase } from './supabase';
import type { Role, StaffRow } from './types';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('staff-login', { body });
  if (error) {
    let msg = 'XS500: something went wrong. Please try again.';
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* not JSON */ }
    if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) msg = error.message;
    throw new Error(msg);
  }
  return data as T;
}

export const createStaffLogin = (gymId: string, name: string, phone: string, role: Role) =>
  call<{ staff: StaffRow; username: string; password: string }>({ action: 'create', gym_id: gymId, name, phone, role });

export const resetStaffPassword = (gymId: string, staffId: string) =>
  call<Credentials>({ action: 'reset', gym_id: gymId, staff_id: staffId });

export const removeStaffLogin = (gymId: string, staffId: string) =>
  call<{ removed: true }>({ action: 'remove', gym_id: gymId, staff_id: staffId });
