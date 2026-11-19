// Calls the xs-billing Edge Function (XS Gym subscription payments via Razorpay).
import { supabase } from './supabase';

export type SaasPrice = { code: string; label: string; months: number; amount_paise: number; sort: number };
export type SaasPayment = {
  id: string; price_code: string; months: number; amount_paise: number;
  status: 'created' | 'paid' | 'expired' | 'cancelled' | 'failed'; mode: 'test' | 'live' | null;
  created_at: string; paid_at: string | null; period_end: string | null;
};

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('xs-billing', { body });
  if (error) {
    let msg = 'XS500: something went wrong. Please try again.';
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* not JSON */ }
    if (/Failed to fetch|NetworkError|Load failed/i.test(error.message)) msg = error.message;
    throw new Error(msg);
  }
  return data as T;
}

/** Makes a Razorpay payment link; the caller sends the browser to `url`. */
export const startSubscriptionPayment = (gymId: string, price: string, returnUrl: string) =>
  call<{ payment_id: string; url: string }>({ action: 'start', gym_id: gymId, price, return_url: returnUrl });

/** Asks the server to confirm with Razorpay; applies the payment if it is paid. */
export const checkSubscriptionPayment = (gymId: string, paymentId: string) =>
  call<{ status: SaasPayment['status']; paid_until?: string | null }>({ action: 'check', gym_id: gymId, payment_id: paymentId });

export async function loadPrices(): Promise<SaasPrice[]> {
  const { data, error } = await supabase.from('saas_prices').select('code,label,months,amount_paise,sort').order('sort');
  if (error) throw error;
  return data as SaasPrice[];
}

export async function loadSubscriptionPayments(gymId: string): Promise<SaasPayment[]> {
  const { data, error } = await supabase.from('saas_payments')
    .select('id,price_code,months,amount_paise,status,mode,created_at,paid_at,period_end')
    .eq('gym_id', gymId).order('created_at', { ascending: false }).limit(10);
  if (error) throw error;
  return data as SaasPayment[];
}
