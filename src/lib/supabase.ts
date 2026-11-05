import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.');
}

export const supabase = createClient(url, key, {
  // Implicit flow: email links (sign-up confirmation, password recovery — including
  // ones sent from the Supabase dashboard) work on any device, not only the
  // browser that requested them. Tokens arrive in the URL fragment, which is
  // never sent to a server, and the client removes it from the address bar.
  auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Calls a database command function and throws on error. */
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export function newKey(): string {
  return crypto.randomUUID();
}
