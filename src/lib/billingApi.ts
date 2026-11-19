// XS Gym subscription billing: plans, entitlements, checkout (xs-billing Edge
// Function → Razorpay payment link), invoices and Xelorsoft admin calls.
// The database decides prices, permissions and access; everything here is display.
import { rpc, supabase } from './supabase';

export type Cycle = 'monthly' | 'annual';
export type SubState = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'GRACE_PERIOD' | 'CANCELED' | 'EXPIRED';
export type Features = Partial<Record<'analytics' | 'enquiries' | 'xs_ai' | 'priority_support', boolean>>;

export type Entitlements = {
  state: SubState; effective_state: SubState; access: 'full' | 'read_only' | 'billing_only'; can_write: boolean;
  plan_id: string; plan_name: string; plan_version_id: string; plan_version: number; provisional: boolean;
  features: Features; limits: { members: number | null; staff: number | null; branches: number };
  usage: { members: number; staff: number };
  billing_cycle: Cycle | null; trial_started_at: string | null; trial_ends_at: string | null; trial_eligible: boolean;
  current_period_start: string | null; current_period_end: string | null; past_due_since: string | null; grace_ends_at: string | null;
  cancel_effective_at: string | null; canceled_at: string | null; pending_plan_id: string | null; pending_cycle: Cycle | null;
  complimentary_until: string | null; is_pilot: boolean; expired_access: 'read_only' | 'billing_only';
};

export type PublicPlan = {
  id: 'starter' | 'growth' | 'pro' | string; name: string; tagline: string | null; rank: number; version: number; provisional: boolean;
  monthly_paise: number | null; annual_paise: number | null; trial_days: number; features: Features;
  member_limit: number | null; staff_limit: number | null; branch_limit: number; addons: string[];
};
export type Feature = { key: string; label: string; description: string | null; gated: boolean; available: boolean; sort: number };
export type Pricing = {
  plans: PublicPlan[]; features: Feature[];
  addons: Array<{ code: string; label: string; description: string | null; monthly_price_paise: number | null; status: string }>;
  terms: { trial_days: number; gst_status: 'unconfirmed' | 'registered' | 'not_registered'; prices_include_gst: boolean; gst_rate_bp: number;
    payment_terms: string; support_email: string; grace_days: number };
};

export type SaasPayment = {
  id: string; price_code: string; months: number; amount_paise: number; credit_paise: number; refunded_paise: number;
  status: 'created' | 'paid' | 'expired' | 'cancelled' | 'failed'; mode: 'test' | 'live' | null; kind: string;
  billing_cycle: Cycle | null; created_at: string; paid_at: string | null; period_start: string | null; period_end: string | null;
  grants_access: boolean | null; failure_reason: string | null;
};
export type Invoice = {
  id: string; gym_id: string; payment_id: string; number: string; doc_type: 'tax_invoice' | 'receipt'; mode: 'test' | 'live';
  issued_at: string; supplier: Record<string, string | null>; customer: Record<string, string | null>;
  lines: Array<{ description: string; kind: string; amount_paise: number }>;
  subtotal_paise: number; credit_paise: number; taxable_paise: number; cgst_paise: number; sgst_paise: number; igst_paise: number;
  tax_paise: number; total_paise: number; gst_rate_bp: number; place_of_supply: string | null;
  period_start: string | null; period_end: string | null; status: 'paid' | 'partially_refunded' | 'refunded'; refunded_paise: number;
};
export type BillingProfile = { legal_name: string | null; gstin: string | null; address: string | null; state_code: string | null; billing_email: string | null };

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

// ---------------------------------------------------------------- customers
export const loadEntitlements = (gymId: string) => rpc<Entitlements | null>('gym_entitlements', { p_gym: gymId });
export const loadPricing = () => rpc<Pricing>('public_pricing', {});

/** Makes a Razorpay payment link for a plan; the caller sends the browser to `url`. */
export const startCheckout = (gymId: string, plan: string, cycle: Cycle, returnUrl: string) =>
  call<{ payment_id: string; url: string; amount_paise: number; kind: string; mode: 'test' | 'live' }>(
    { action: 'start', gym_id: gymId, plan, cycle, return_url: returnUrl });

/** Asks the server to confirm with Razorpay; applies the payment if it is paid. */
export const checkSubscriptionPayment = (gymId: string, paymentId: string) =>
  call<{ status: SaasPayment['status']; paid_until?: string | null; invoice?: string; grants_access?: boolean }>(
    { action: 'check', gym_id: gymId, payment_id: paymentId });

export type CheckoutQuote = {
  plan_id: string; plan_name: string; cycle: Cycle; months: number; kind: 'new' | 'renewal' | 'upgrade'; provisional: boolean;
  list_price_paise: number; credit_paise: number; amount_paise: number; tax_paise: number; period_start: string; period_end: string;
  gst_status: string; prices_include_gst: boolean;
};
export const quoteCheckout = (gymId: string, plan: string, cycle: Cycle) =>
  rpc<CheckoutQuote>('prepare_saas_checkout', { p_gym: gymId, p_plan: plan, p_cycle: cycle });
export const schedulePlanChange = (gymId: string, plan: string, cycle: Cycle) =>
  rpc<{ scheduled: boolean; effective_at: string }>('schedule_plan_change', { p_gym: gymId, p_plan: plan, p_cycle: cycle });
export const cancelPlanChange = (gymId: string) => rpc<void>('cancel_plan_change', { p_gym: gymId });
export const cancelSubscription = (gymId: string, reason: string) =>
  rpc<{ cancelled: boolean; access_until: string }>('cancel_subscription', { p_gym: gymId, p_reason: reason });
export const resumeSubscription = (gymId: string) => rpc<{ resumed: boolean; state: SubState }>('resume_subscription', { p_gym: gymId });
export const saveBillingProfile = (gymId: string, p: BillingProfile) => rpc<BillingProfile>('save_billing_profile', {
  p_gym: gymId, p_legal_name: p.legal_name, p_gstin: p.gstin, p_address: p.address, p_state_code: p.state_code, p_email: p.billing_email });

export async function loadBillingProfile(gymId: string): Promise<BillingProfile | null> {
  const { data, error } = await supabase.from('saas_billing_profiles').select('legal_name,gstin,address,state_code,billing_email').eq('gym_id', gymId).maybeSingle();
  if (error) throw error;
  return data as BillingProfile | null;
}
export async function loadSubscriptionPayments(gymId: string): Promise<SaasPayment[]> {
  const { data, error } = await supabase.from('saas_payments')
    .select('id,price_code,months,amount_paise,credit_paise,refunded_paise,status,mode,kind,billing_cycle,created_at,paid_at,period_start,period_end,grants_access,failure_reason')
    .eq('gym_id', gymId).order('created_at', { ascending: false }).limit(24);
  if (error) throw error;
  return data as SaasPayment[];
}
export async function loadInvoices(gymId: string): Promise<Invoice[]> {
  const { data, error } = await supabase.from('saas_invoices').select('*').eq('gym_id', gymId).order('issued_at', { ascending: false }).limit(50);
  if (error) throw error;
  return data as Invoice[];
}
export async function loadInvoice(id: string): Promise<Invoice | null> {
  const { data, error } = await supabase.from('saas_invoices').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Invoice | null;
}

// ---------------------------------------------------------------- Xelorsoft admin
export type AdminRole = 'owner' | 'admin' | 'viewer';
export type AdminSub = {
  gym_id: string; gym: string; slug: string; phone: string | null; created_at: string; owner_email: string | null;
  state: SubState; effective_state: SubState; plan_id: string | null; plan_version: number | null; cycle: Cycle | null;
  trial_ends_at: string | null; period_end: string | null; complimentary_until: string | null; is_pilot: boolean;
  cancel_effective_at: string | null; members: number; staff: number; mrr_paise: number | null; last_payment_at: string | null; paid_total_paise: number;
};
export type Metrics = {
  mrr_paise: number; arr_paise: number; paying_customers: number; arpu_paise: number; cogs_paise: number; gross_margin_pct: number | null;
  cac_spend_paise: number; new_paying_this_month: number; contribution_paise: number; contribution_margin_pct: number | null;
  fixed_costs_paise: number; operating_profit_paise: number; variable_cost_per_customer_paise: number; break_even_customers: number | null;
  churn_30d_pct: number | null; definitions: Record<string, string>;
};
export type Overview = {
  gyms_total: number; by_state: Record<string, number>; by_plan: Record<string, number>; trials: number; trials_ending_7d: number;
  past_due: number; expired: number; complimentary: number; collected_this_month_paise: number; refunded_this_month_paise: number;
  test_payments_this_month: number; failed_payments_30d: number; open_disputes: number; failed_webhooks: number; metrics: Metrics;
};
export type PlanVersion = {
  id: string; plan_id: string; plan_name: string; is_public: boolean; version: number; monthly_price_paise: number | null; annual_price_paise: number | null;
  trial_days: number; features: Features; member_limit: number | null; staff_limit: number | null; branch_limit: number;
  status: 'draft' | 'active' | 'retired'; provisional: boolean; effective_from: string | null; effective_to: string | null; notes: string | null; subscribers: number;
};
export type AuditRow = { id: number; created_at: string; action: string; target_type: string; target_id: string; reason: string | null; actor: string | null; before: unknown; after: unknown };

export const adminRole = () => rpc<AdminRole | null>('is_platform_admin', {});
export const adminOverview = () => rpc<Overview>('admin_overview', {});
export const adminSubscriptions = () => rpc<AdminSub[]>('admin_subscriptions', {});
export const adminGymBilling = (gymId: string) => rpc<{ entitlements: Entitlements; payments: SaasPayment[]; invoices: Array<Pick<Invoice, 'id' | 'number' | 'issued_at' | 'total_paise' | 'status' | 'mode'>>; refunds: unknown[]; events: Array<{ id: number; event: string; from_state: string | null; to_state: string | null; source: string; details: Record<string, unknown>; created_at: string }> }>('admin_gym_billing', { p_gym: gymId });
export const adminExtendTrial = (gymId: string, days: number, reason: string) => rpc('admin_extend_trial', { p_gym: gymId, p_days: days, p_reason: reason });
export const adminGrantComplimentary = (gymId: string, until: string | null, plan: string, reason: string) =>
  rpc('admin_grant_complimentary', { p_gym: gymId, p_until: until, p_plan: plan, p_reason: reason });
export const adminEndComplimentary = (gymId: string, at: string, reason: string) => rpc('admin_end_complimentary', { p_gym: gymId, p_at: at, p_reason: reason });
export const adminSetState = (gymId: string, state: SubState, reason: string) => rpc('admin_set_state', { p_gym: gymId, p_state: state, p_reason: reason });
export const adminRecordRefund = (paymentId: string, amount: number, reason: string) => rpc('admin_record_refund', { p_payment: paymentId, p_amount_paise: amount, p_reason: reason });
export const adminPlanVersions = () => rpc<PlanVersion[]>('admin_list_plan_versions', {});
export const adminSavePlanVersion = (v: { plan: string; monthly: number | null; annual: number | null; trial_days: number; features: Features; member_limit: number | null; staff_limit: number | null; branch_limit: number; notes: string }) =>
  rpc<PlanVersion>('admin_save_plan_version', { p_plan: v.plan, p_monthly: v.monthly, p_annual: v.annual, p_trial_days: v.trial_days, p_features: v.features,
    p_member_limit: v.member_limit, p_staff_limit: v.staff_limit, p_branch_limit: v.branch_limit, p_notes: v.notes });
export const adminActivateVersion = (id: string, reason: string) => rpc('admin_activate_plan_version', { p_version: id, p_reason: reason });
export const adminSettings = () => rpc<{ billing: Record<string, unknown>; cost_model: Record<string, unknown>; role: AdminRole }>('admin_get_settings', {});
export const adminUpdateSettings = (patch: Record<string, unknown>, reason: string) => rpc('admin_update_billing_settings', { p_patch: patch, p_reason: reason });
export const adminSaveCostModel = (patch: Record<string, unknown>, reason: string) => rpc('admin_save_cost_model', { p_patch: patch, p_reason: reason });
export const adminAudit = (limit = 200) => rpc<AuditRow[]>('admin_audit_log', { p_limit: limit });
export const adminExport = (kind: 'subscriptions' | 'payments' | 'invoices' | 'events') => rpc<Array<Record<string, unknown>>>('admin_export', { p_kind: kind });
export const adminReconcile = () => call<{ checked: number; applied: number; expired: number }>({ action: 'reconcile' });

// ---------------------------------------------------------------- display helpers
export const STATE_LABEL: Record<SubState, string> = {
  TRIALING: 'Free trial', ACTIVE: 'Active', PAST_DUE: 'Renewal due', GRACE_PERIOD: 'Grace period', CANCELED: 'Cancelled', EXPIRED: 'Ended',
};
export const STATE_TONE: Record<SubState, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  TRIALING: 'info', ACTIVE: 'ok', PAST_DUE: 'warn', GRACE_PERIOD: 'warn', CANCELED: 'neutral', EXPIRED: 'bad',
};
export const FEATURE_PLAN: Record<string, string> = { analytics: 'Growth', enquiries: 'Growth', xs_ai: 'Growth', priority_support: 'Pro' };
export const isComplimentary = (e: Pick<Entitlements, 'complimentary_until'> | null | undefined) =>
  !!e?.complimentary_until && (e.complimentary_until === 'infinity' || Date.parse(e.complimentary_until) > Date.now());
export const yearlySaving = (p: Pick<PublicPlan, 'monthly_paise' | 'annual_paise'>) =>
  p.monthly_paise && p.annual_paise ? p.monthly_paise * 12 - p.annual_paise : 0;
