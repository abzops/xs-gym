// Mocked Supabase API and signed-in session shared by the UI tests.
// Everything is local: no request leaves the machine.
export const REF = process.env.XS_TEST_SUPABASE_REF || 'knuanihnxtxtyrgvsumq';
const userId = '11111111-1111-4111-8111-111111111111';
export const gym = { id: '22222222-2222-4222-8222-222222222222', name: 'Iron Temple Kozhikode', slug: 'iron-temple', timezone: 'Asia/Kolkata',
  currency: 'INR', phone: null, email: null, address: null, grace_days: 3, status: 'active', created_at: '2026-11-01T00:00:00Z', onboarded_at: '2026-11-01T00:10:00Z' };
const perms = ['members.read','members.write','members.archive','members.export','plans.read','plans.manage','memberships.sell','memberships.cancel','memberships.pause','memberships.edit_dates',
  'attendance.checkin','attendance.override','attendance.correct','payments.record','payments.read','payments.reverse','discounts.apply','charges.void',
  'expenses.record','expenses.read','expenses.reverse','reports.operational','reports.financial','staff.read','staff.manage','gym.settings','billing.manage','audit.read'];
const member = (i, over = {}) => ({
  id: `33333333-3333-4333-8333-33333333333${i}`, gym_id: gym.id, member_no: `XS-000${i}`, full_name: ['Rahul Krishnan', 'Anjali Menon', 'Mohammed Shafi', 'Priya Nair', 'Arjun Das'][i - 1],
  phone: `+9198765000${i}${i}`, email: null, gender: null, date_of_birth: null, address: null, emergency_contact: null, join_date: '2026-10-02',
  status: 'active', created_at: '2026-10-02T05:00:00Z', membership_id: 'm', plan_name: 'Monthly', start_date: '2026-10-20', end_date: '2026-11-19',
  valid_until: '2026-11-19', membership_status: 'active', due_paise: 0, credit_paise: 0, last_check_in_at: '2026-11-05T02:40:00Z', ...over,
});
export const members = [member(1, { due_paise: 50000 }), member(2), member(3, { membership_status: 'grace', valid_until: '2026-11-03', end_date: '2026-11-03' }),
  member(4, { membership_status: 'expired', valid_until: '2026-10-01' }), member(5, { plan_name: null, valid_until: null, membership_status: 'none' })];

import { readFileSync } from 'node:fs';
const analytics = JSON.parse(readFileSync(new URL('./analytics.fixture.json', import.meta.url), 'utf8'));
export const enquiries = [
  { id: 'q1', gym_id: gym.id, full_name: 'Rahul Menon', phone: '+919876500101', source: 'instagram', interest: 'Monthly', notes: null, status: 'new', follow_up_date: '2026-11-05', member_id: null, created_at: '2026-11-04T05:00:00Z', updated_at: '2026-11-04T05:00:00Z', closed_at: null },
  { id: 'q2', gym_id: gym.id, full_name: 'Sneha Pillai', phone: '+919876500102', source: 'walk_in', interest: 'Weight loss', notes: 'Evenings only', status: 'trial', follow_up_date: '2026-11-08', member_id: null, created_at: '2026-11-03T05:00:00Z', updated_at: '2026-11-03T05:00:00Z', closed_at: null },
  { id: 'q3', gym_id: gym.id, full_name: 'Arjun Das', phone: '+919876500103', source: 'referral', interest: null, notes: null, status: 'joined', follow_up_date: null, member_id: 'x', created_at: '2026-10-20T05:00:00Z', updated_at: '2026-10-22T05:00:00Z', closed_at: '2026-10-22T05:00:00Z' }];
// ---------- XS Gym subscription fixtures (synthetic) ----------
const feats = (a, e, x, s) => ({ analytics: a, enquiries: e, xs_ai: x, priority_support: s });
export const pricing = {
  plans: [
    { id: 'starter', name: 'Starter', tagline: 'Everything a single gym needs at the front desk', rank: 1, version: 1, provisional: true, monthly_paise: 49900, annual_paise: 499000, trial_days: 30, features: feats(false, false, false, false), member_limit: 200, staff_limit: 2, branch_limit: 1, addons: [] },
    { id: 'growth', name: 'Growth', tagline: 'Analytics, leads and XS AI for a growing gym', rank: 2, version: 1, provisional: true, monthly_paise: 99900, annual_paise: 999000, trial_days: 30, features: feats(true, true, true, false), member_limit: 1000, staff_limit: 6, branch_limit: 1, addons: [] },
    { id: 'pro', name: 'Pro', tagline: 'No member limit, more staff and priority support', rank: 3, version: 1, provisional: true, monthly_paise: 199900, annual_paise: 1999000, trial_days: 30, features: feats(true, true, true, true), member_limit: null, staff_limit: 20, branch_limit: 1, addons: ['extra_branch'] }],
  features: [
    ['core_operations', 'Members, plans, renewals, payments and receipts', false, true], ['expenses', 'Expenses and daily collection report', false, true],
    ['dues_reminders', 'Dues and expiry lists with WhatsApp reminders', false, true], ['csv_import_export', 'Import members from Excel and export your data', false, true],
    ['membership_pause', 'Pause memberships and edit dates', false, true], ['staff_logins', 'Staff logins with roles', false, true],
    ['analytics', 'Analytics', true, true], ['enquiries', 'Enquiries (leads) with follow-ups', true, true], ['xs_ai', 'XS AI assistant', true, true],
    ['priority_support', 'Priority WhatsApp support', false, true], ['multi_branch', 'Several branches under one account', false, false], ['auto_whatsapp', 'Automatic WhatsApp reminders', false, false],
  ].map(([key, label, gated, available], i) => ({ key, label, description: null, gated, available, sort: i + 1 })),
  addons: [{ code: 'extra_branch', label: 'Extra branch', description: null, monthly_price_paise: null, status: 'planned' }],
  terms: { trial_days: 30, gst_status: 'unconfirmed', prices_include_gst: true, gst_rate_bp: 1800, support_email: 'billing@xelorsoft.com', grace_days: 10,
    payment_terms: 'Plans are prepaid for one month or one year. Nothing renews or is charged automatically.' },
};
const ent = (over = {}) => ({ state: 'TRIALING', effective_state: 'TRIALING', access: 'full', can_write: true, plan_id: 'pro', plan_name: 'Pro', plan_version_id: 'v', plan_version: 1,
  provisional: true, features: feats(true, true, true, true), limits: { members: null, staff: 20, branches: 1 }, usage: { members: 128, staff: 1 }, billing_cycle: null,
  trial_started_at: '2026-11-01T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z', trial_eligible: true, current_period_start: null, current_period_end: null,
  past_due_since: null, grace_ends_at: null, cancel_effective_at: null, canceled_at: null, pending_plan_id: null, pending_cycle: null, complimentary_until: null,
  is_pilot: false, expired_access: 'read_only', ...over });
export const ENTITLEMENTS = {
  trial: ent(),
  growth: ent({ state: 'ACTIVE', effective_state: 'ACTIVE', plan_id: 'growth', plan_name: 'Growth', provisional: false, features: feats(true, true, true, false),
    limits: { members: 1000, staff: 6, branches: 1 }, billing_cycle: 'monthly', current_period_start: '2026-11-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z' }),
  starter: ent({ state: 'ACTIVE', effective_state: 'ACTIVE', plan_id: 'starter', plan_name: 'Starter', features: feats(false, false, false, false),
    limits: { members: 200, staff: 2, branches: 1 }, usage: { members: 187, staff: 2 }, billing_cycle: 'monthly', current_period_start: '2026-11-01T00:00:00Z', current_period_end: '2026-12-01T00:00:00Z' }),
  expired: ent({ state: 'EXPIRED', effective_state: 'EXPIRED', access: 'read_only', can_write: false, trial_ends_at: '2026-10-31T00:00:00Z' }),
  pastdue: ent({ state: 'ACTIVE', effective_state: 'PAST_DUE', plan_id: 'growth', plan_name: 'Growth', features: feats(true, true, true, false), billing_cycle: 'monthly',
    current_period_start: '2026-10-03T00:00:00Z', current_period_end: '2026-11-03T00:00:00Z', grace_ends_at: '2026-11-13T00:00:00Z' }),
  pilot: ent({ state: 'ACTIVE', effective_state: 'ACTIVE', plan_id: 'pilot', plan_name: 'Pilot', provisional: false, complimentary_until: 'infinity', is_pilot: true, limits: { members: null, staff: null, branches: 1 } }),
};
export const state = { entitlements: ENTITLEMENTS.trial, admin: null };
const invoice = { id: 'inv1', gym_id: gym.id, payment_id: 'sp1', number: 'TEST/2026-27/0003', doc_type: 'receipt', mode: 'test', issued_at: '2026-11-01T06:00:00Z',
  supplier: { name: 'Xelorsoft', email: 'billing@xelorsoft.com', state_code: '32', gst_status: 'unconfirmed' }, customer: { name: 'Iron Temple Kozhikode', phone: '+919876500001', gym: gym.name },
  lines: [{ description: 'XS Gym Growth — 1 month', kind: 'new', amount_paise: 99900 }], subtotal_paise: 99900, credit_paise: 0, taxable_paise: 99900,
  cgst_paise: 0, sgst_paise: 0, igst_paise: 0, tax_paise: 0, total_paise: 99900, gst_rate_bp: 0, place_of_supply: '32', period_start: '2026-11-01T00:00:00Z',
  period_end: '2026-12-01T00:00:00Z', status: 'paid', refunded_paise: 0 };
const adminSubs = [
  { gym_id: gym.id, gym: 'Iron Temple Kozhikode', slug: 'iron-temple', phone: '+919876500001', created_at: '2026-11-01T00:00:00Z', owner_email: 'owner@example.com', state: 'ACTIVE', effective_state: 'ACTIVE', plan_id: 'growth', plan_version: 1, cycle: 'monthly', trial_ends_at: null, period_end: '2026-12-01T00:00:00Z', complimentary_until: null, is_pilot: false, cancel_effective_at: null, members: 128, staff: 1, mrr_paise: 99900, last_payment_at: '2026-11-01T06:00:00Z', paid_total_paise: 99900 },
  { gym_id: 'g2', gym: 'CHAOS COMBAT', slug: 'chaos', phone: null, created_at: '2026-11-09T00:00:00Z', owner_email: 'chaos@example.com', state: 'ACTIVE', effective_state: 'ACTIVE', plan_id: 'pilot', plan_version: 1, cycle: null, trial_ends_at: '2026-12-09T00:00:00Z', period_end: null, complimentary_until: 'infinity', is_pilot: true, cancel_effective_at: null, members: 26, staff: 0, mrr_paise: null, last_payment_at: null, paid_total_paise: 0 },
  { gym_id: 'g3', gym: 'Super Gym', slug: 'super', phone: '+919876500003', created_at: '2026-11-16T00:00:00Z', owner_email: 'super@example.com', state: 'TRIALING', effective_state: 'TRIALING', plan_id: 'pro', plan_version: 1, cycle: null, trial_ends_at: '2026-11-24T00:00:00Z', period_end: null, complimentary_until: null, is_pilot: false, cancel_effective_at: null, members: 2, staff: 0, mrr_paise: null, last_payment_at: null, paid_total_paise: 0 }];
const metrics = { mrr_paise: 99900, arr_paise: 1198800, paying_customers: 1, arpu_paise: 99900, cogs_paise: 20258, gross_margin_pct: 79.7, cac_spend_paise: 150000,
  new_paying_this_month: 1, contribution_paise: -70358, contribution_margin_pct: -70.4, fixed_costs_paise: 230000, operating_profit_paise: -300358,
  variable_cost_per_customer_paise: 20258, break_even_customers: 3, churn_30d_pct: null,
  definitions: { mrr: 'Monthly value of live-paid subscriptions.', arr: 'MRR × 12.', gross_margin: '(MRR − COGS) ÷ MRR.', break_even: 'Fixed costs ÷ (ARPU − variable cost).' } };
function billingBody(p, u) {
  if (p.includes('/rpc/gym_entitlements')) return state.entitlements;
  if (p.includes('/rpc/public_pricing')) return pricing;
  if (p.includes('/rpc/prepare_saas_checkout')) return { plan_id: 'growth', plan_name: 'Growth', cycle: 'monthly', months: 1, kind: 'new', provisional: true, list_price_paise: 99900,
    credit_paise: 0, amount_paise: 99900, tax_paise: 0, period_start: '2026-12-01T00:00:00Z', period_end: '2027-01-01T00:00:00Z', gst_status: 'unconfirmed', prices_include_gst: true };
  if (p.endsWith('/saas_payments')) return [{ id: 'sp2', price_code: 'monthly', months: 1, amount_paise: 99900, credit_paise: 0, refunded_paise: 0, status: 'expired', mode: 'test', kind: 'new',
    billing_cycle: 'monthly', created_at: '2026-10-30T06:00:00Z', paid_at: null, period_start: null, period_end: null, grants_access: null, failure_reason: null }];
  if (p.endsWith('/saas_invoices')) return u.searchParams.has('id') ? invoice : [invoice];
  if (p.endsWith('/saas_billing_profiles')) return null;
  if (p.includes('/rpc/is_platform_admin')) return state.admin;
  if (p.includes('/rpc/admin_overview')) return { gyms_total: 3, by_state: { ACTIVE: 2, TRIALING: 1 }, by_plan: { growth: 1, pilot: 1, pro: 1 }, trials: 1, trials_ending_7d: 1,
    past_due: 0, expired: 0, complimentary: 1, collected_this_month_paise: 99900, refunded_this_month_paise: 0, test_payments_this_month: 2, failed_payments_30d: 1,
    open_disputes: 0, failed_webhooks: 0, metrics };
  if (p.includes('/rpc/admin_subscriptions')) return adminSubs;
  if (p.includes('/rpc/admin_list_plan_versions')) return pricing.plans.map((pl) => ({ id: `v-${pl.id}`, plan_id: pl.id, plan_name: pl.name, is_public: true, version: 1,
    monthly_price_paise: pl.monthly_paise, annual_price_paise: pl.annual_paise, trial_days: 30, features: pl.features, member_limit: pl.member_limit, staff_limit: pl.staff_limit,
    branch_limit: 1, status: 'draft', provisional: true, effective_from: null, effective_to: null, notes: null, subscribers: pl.id === 'growth' ? 1 : 0 }));
  if (p.includes('/rpc/admin_get_settings')) return { role: 'owner', billing: { default_trial_days: 30, trial_plan_id: 'pro', past_due_days: 3, grace_days: 7, expired_access: 'read_only',
    gst_status: 'unconfirmed', gstin: null, gst_rate_bp: 1800, prices_include_gst: true, legal_name: 'Xelorsoft', supplier_state_code: '32', support_email: 'billing@xelorsoft.com',
    invoice_prefix: 'XS', payment_terms: pricing.terms.payment_terms, allow_provisional_checkout: true, test_payments_grant_access: false },
    cost_model: { fixed_infra_monthly_paise: 230000, infra_per_gym_monthly_paise: 2000, ai_cost_per_gym_monthly_paise: { starter: 0, growth: 6000, pro: 12000 }, gateway_fee_bp: 236,
      support_per_gym_monthly_paise: 10000, cac_paise: 150000, fixed_overhead_monthly_paise: 0 } };
  if (p.includes('/rpc/admin_audit_log')) return [{ id: 1, created_at: '2026-11-19T10:00:00Z', action: 'plan_version.create', target_type: 'plan_version', target_id: 'v-growth', reason: 'Initial draft', actor: 'founder@xelorsoft.com', before: null, after: {} }];
  return undefined;
}
export function body(url) {
  const u = new URL(url);
  const p = u.pathname;
  const billing = billingBody(p, u);
  if (billing !== undefined) return billing;
  if (p.includes('/rpc/dashboard_summary')) return { today: '2026-11-05', timezone: 'Asia/Kolkata', active_members: 128, in_grace: 6, expiring_today: 2,
    expiring_7_days: 14, expiring_30_days: 41, expired_last_30_days: 9, new_members_month: 12,
    financial: { collections_today: 1850000, collections_month: 21450000, cash_today: 1100000, upi_today: 750000, other_today: 0, reversals_today: 0,
      reversals_month: 100000, expenses_today: 50000, expenses_month: 4200000, dues_total: 2350000, members_with_dues: 17 } };
  if (p.includes('/rpc/gym_analytics')) return analytics;
  if (p.endsWith('/enquiries')) return enquiries;
  if (p.includes('/rpc/daily_report')) return Array.from({ length: 5 }, (_, i) => ({ day: `2026-11-0${5 - i}`, collections_paise: 1850000 - i * 100000,
    reversals_paise: i === 2 ? 100000 : 0, cash_paise: 1000000, upi_paise: 750000 - i * 100000, other_paise: 100000, expenses_paise: 50000, new_members: 1 }));
  if (p.endsWith('/gym_staff')) return u.searchParams.has('gym_id')
    ? (u.searchParams.get('select') === 'role' ? { role: 'owner' } : [{ id: 's1', gym_id: gym.id, user_id: userId, role: 'owner', status: 'active', display_name: 'Jazeel', email: 'owner@example.com' },
        { id: 's2', gym_id: gym.id, user_id: 'x', role: 'reception', status: 'active', display_name: 'Desk', email: 'desk@example.com' }])
    : [{ role: 'owner', status: 'active', gyms: { id: gym.id, name: gym.name, slug: gym.slug } }];
  if (p.endsWith('/gyms')) return gym;
  if (p.endsWith('/gym_subscriptions')) return { gym_id: gym.id, plan: 'max', status: 'trial', trial_started_at: '2026-11-01T00:00:00Z', trial_ends_at: '2026-12-01T00:00:00Z', paid_until: null };
  if (p.endsWith('/role_permissions')) return perms.map((permission) => ({ permission }));
  if (p.endsWith('/member_overview')) return u.searchParams.has('id') ? members[0] : members;
  if (p.endsWith('/membership_plans')) return [
    { id: 'p1', gym_id: gym.id, name: 'Monthly', duration_unit: 'month', duration_count: 1, price_paise: 100000, description: null, status: 'active' },
    { id: 'p2', gym_id: gym.id, name: 'Quarterly', duration_unit: 'month', duration_count: 3, price_paise: 270000, description: 'Save ₹300', status: 'active' },
    { id: 'p3', gym_id: gym.id, name: 'Yearly', duration_unit: 'month', duration_count: 12, price_paise: 960000, description: null, status: 'active' }];
  if (p.endsWith('/attendance_events')) return members.slice(0, 4).map((m, i) => ({ id: `a${i}`, member_id: m.id, checked_in_at: `2026-11-05T0${3 - i}:1${i}:00Z`,
    membership_status: 'active', override_reason: null, voided_at: null, void_reason: null, members: { full_name: m.full_name, member_no: m.member_no } }));
  if (p.endsWith('/payments') && u.searchParams.get('id') === 'eq.py1') return [body(url.replace('id=eq.py1', 'x=1'))[0]];
  if (p.endsWith('/payments')) return [
    { id: 'py1', gym_id: gym.id, member_id: members[0].id, amount_paise: 100000, method: 'upi', received_at: '2026-11-05T03:30:00Z', reference: 'UTR 4521', notes: null,
      payment_reversals: [], members: { full_name: members[0].full_name, member_no: 'XS-0001', phone: '+919876500011' },
      payment_allocations: [{ amount_paise: 50000, charges: { description: 'Admission fee' } }, { amount_paise: 50000, charges: { description: 'Monthly · 20 Oct 2026 – 19 Nov 2026' } }] },
    { id: 'py2', gym_id: gym.id, member_id: members[1].id, amount_paise: 270000, method: 'cash', received_at: '2026-11-05T02:10:00Z', reference: null, notes: null,
      payment_reversals: [{ id: 'r', reason: 'Wrong member', reversed_at: '2026-11-05T02:20:00Z' }], members: { full_name: members[1].full_name, member_no: 'XS-0002' } }];
  if (p.endsWith('/member_memberships')) return [{ id: 'mm1', member_id: members[0].id, plan_id: 'p1', plan_name: 'Monthly', start_date: '2026-10-20', end_date: '2026-11-19', price_paise: 100000, status: 'active', cancel_reason: null, created_at: '2026-10-20T00:00:00Z' }];
  if (p.endsWith('/charges')) return [{ id: 'c1', member_id: members[0].id, membership_id: 'mm1', kind: 'membership', description: 'Monthly · 20 Oct 2026 – 19 Nov 2026',
    gross_paise: 100000, discount_paise: 0, net_paise: 100000, discount_reason: null, due_date: '2026-10-20', status: 'open', void_reason: null, created_at: '2026-10-20T00:00:00Z' }];
  if (p.endsWith('/expenses')) return [{ id: 'e1', amount_paise: 50000, expense_date: '2026-11-05', method: 'cash', description: 'Bulbs', created_at: '2026-11-05T04:00:00Z',
    expense_categories: { name: 'Maintenance' }, expense_reversals: [] }];
  if (p.endsWith('/expense_categories')) return [{ name: 'Maintenance' }];
  return [];
}

const fakeJwt = (payload) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const exp = Math.floor(Date.now() / 1000) + 3600;
export const session = { access_token: fakeJwt({ sub: userId, exp, role: 'authenticated' }), refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp,
  user: { id: userId, email: 'owner@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' } };

/** Signs the context in and answers every Supabase call from the fixtures above. */
export async function mockApi(ctx) {
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await ctx.route(`https://${REF}.supabase.co/**`, (route) => {
    const accept = route.request().headers()['accept'] ?? '';
    let data = body(route.request().url());
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
}
