// Mocked Supabase API and signed-in session shared by the UI tests.
// Everything is local: no request leaves the machine.
export const REF = 'sarvamvoicepoc';
const userId = '11111111-1111-4111-8111-111111111111';
export const gym = { id: '22222222-2222-4222-8222-222222222222', name: 'Iron Temple Kozhikode', slug: 'iron-temple', timezone: 'Asia/Kolkata',
  currency: 'INR', phone: null, email: null, address: null, grace_days: 3, status: 'active', created_at: '2026-11-01T00:00:00Z', onboarded_at: '2026-11-01T00:10:00Z' };
const perms = ['members.read','members.write','members.archive','members.export','plans.read','plans.manage','memberships.sell','memberships.cancel',
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
export function body(url) {
  const u = new URL(url);
  const p = u.pathname;
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
