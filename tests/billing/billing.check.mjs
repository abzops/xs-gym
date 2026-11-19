// xs-billing and xs-billing-webhook contracts. No live Supabase or Razorpay:
// fetch is scripted. Runs with Node's TypeScript stripping:
//   node --experimental-strip-types tests/billing/billing.check.mjs
import { createHmac } from 'node:crypto';

let handler;
const ENV = {
  SUPABASE_URL: 'http://sb.local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'rzp-secret', RAZORPAY_WEBHOOK_SECRET: 'whsec-1',
};
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (fn) => { handler = fn; } };

let calls = [];
let script = {};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const call = { url: u, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
  calls.push(call);
  for (const [k, fn] of Object.entries(script)) if (u.includes(k) && (!fn.method || fn.method === call.method)) return fn(call);
  throw new Error('Unexpected request ' + call.method + ' ' + u);
};
for (const k of ['log', 'warn', 'error']) console[k] = () => {};
const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; out((ok ? 'ok   ' : 'FAIL ') + label); };

const GYM = '11111111-1111-4111-8111-111111111111';
const PAY = '22222222-2222-4222-8222-222222222222';
const VER = '33333333-3333-4333-8333-333333333333';
const prepared = {
  gym_id: GYM, gym_name: 'Iron Temple', gym_phone: '+919876500001', slug: 'iron', user_id: '44444444-4444-4444-8444-444444444444',
  email: 'owner@iron.test', price_code: 'monthly', label: 'Growth monthly', months: 1, amount_paise: 99900,
  plan_id: 'growth', plan_name: 'Growth', plan_version_id: VER, provisional: true, cycle: 'monthly', kind: 'new',
  list_price_paise: 99900, credit_paise: 0,
};

// ============================================================ xs-billing
await import('../../supabase/functions/xs-billing/index.ts');
const billing = handler;
const post = (body, token = 'owner-jwt') => billing(new Request('https://x.invalid/functions/v1/xs-billing', {
  method: 'POST', headers: { origin: 'https://gym.xelorsoft.com', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}));
const start = { action: 'start', gym_id: GYM, plan: 'growth', cycle: 'monthly', return_url: 'https://gym.xelorsoft.com/g/iron/settings' };

calls = []; script = {
  'rpc/prepare_saas_checkout': () => reply(200, prepared),
  '/rest/v1/saas_payments': (c) => c.method === 'POST' ? reply(201, [{ id: PAY }]) : new Response(null, { status: 204 }),
  'api.razorpay.com/v1/payment_links': () => reply(200, { id: 'plink_1', short_url: 'https://rzp.io/i/abc' }),
};
let res = await post(start);
let body = await res.json();
check('start: returns the Razorpay link', res.status === 200 && body.url === 'https://rzp.io/i/abc' && body.payment_id === PAY);
check('start: price decided by the database as the owner, first', calls[0].url.endsWith('/rest/v1/rpc/prepare_saas_checkout')
  && calls[0].headers.authorization === 'Bearer owner-jwt' && calls[0].headers.apikey === 'anon' && calls[0].body.p_plan === 'growth');
const ins = calls.find((c) => c.url.endsWith('/rest/v1/saas_payments') && c.method === 'POST');
check('start: payment recorded with the service key, test mode, plan version and kind', ins?.headers.authorization === 'Bearer service'
  && ins.body.mode === 'test' && ins.body.plan_version_id === VER && ins.body.kind === 'new' && ins.body.amount_paise === 99900);
const lk = calls.find((c) => c.url.endsWith('/payment_links'));
check('start: link amount equals the database price', lk?.body.amount === 99900 && lk.body.currency === 'INR' && lk.body.accept_partial === false);
check('start: link tagged for XS Gym and this payment', lk?.body.notes.product === 'xs-gym' && lk.body.notes.saas_payment_id === PAY);
check('start: returns to the app with the payment id', new URL(lk?.body.callback_url).searchParams.get('billing') === PAY);
check('start: Razorpay called with key id and secret (Basic auth)', lk?.headers.authorization === 'Basic ' + Buffer.from('rzp_test_abc:rzp-secret').toString('base64'));
check('start: never cached', res.headers.get('cache-control') === 'no-store');

ENV.RAZORPAY_KEY_ID = 'rzp_live_abc'; calls = [];
res = await post(start); body = await res.json();
check('start: provisional prices refused with LIVE keys', res.status === 503 && /not final/.test(body.error));
check('start: nothing recorded or linked when refused', !calls.some((c) => c.url.includes('saas_payments') || c.url.includes('razorpay')));
script['rpc/prepare_saas_checkout'] = () => reply(200, { ...prepared, provisional: false });
calls = [];
res = await post(start);
check('start: approved prices allowed with LIVE keys', res.status === 200 && calls.find((c) => c.url.endsWith('/rest/v1/saas_payments'))?.body.mode === 'live');
ENV.RAZORPAY_KEY_ID = 'rzp_test_abc';

calls = []; res = await post({ ...start, return_url: 'https://evil.example/steal' });
check('start: return address must be an XS Gym origin', res.status === 400 && calls.length === 0);
calls = []; script['rpc/prepare_saas_checkout'] = () => reply(403, { message: 'XS403: only the gym owner can pay for XS Gym' });
res = await post(start);
check('start: non-owner refused by the database, no link made', res.status === 403 && !calls.some((c) => c.url.includes('razorpay')));
script['rpc/prepare_saas_checkout'] = () => reply(200, prepared);
const keep = ENV.RAZORPAY_KEY_SECRET; delete ENV.RAZORPAY_KEY_SECRET; calls = [];
res = await post(start); body = await res.json();
check('start: without Razorpay keys says it is not set up (no fake checkout)', res.status === 503 && /not set up/.test(body.error) && calls.length === 0);
ENV.RAZORPAY_KEY_SECRET = keep;
res = await post(start, null);
check('start: sign-in required', res.status === 401);

// legacy body from older app builds
calls = []; script['rpc/prepare_saas_payment'] = () => reply(200, { ...prepared, plan_id: undefined, provisional: undefined, kind: undefined, label: 'Monthly' });
res = await post({ action: 'start', gym_id: GYM, price: 'monthly', return_url: start.return_url });
check('start: older app builds still work (legacy price)', res.status === 200 && calls[0].url.endsWith('rpc/prepare_saas_payment')
  && calls.find((c) => c.url.endsWith('/rest/v1/saas_payments'))?.body.kind === undefined);

// check: only Razorpay's word counts
calls = []; script = {
  '/rest/v1/saas_payments?id=eq.': () => reply(200, [{ id: PAY, status: 'created', link_id: 'plink_1', amount_paise: 99900, period_end: null }]),
  'api.razorpay.com/v1/payment_links/plink_1': () => reply(200, { status: 'paid', amount_paid: 99900, payments: [{ payment_id: 'pay_1', status: 'captured', amount: 99900 }] }),
  'rpc/apply_saas_payment': () => reply(200, { paid_until: '2026-12-19T00:00:00Z', invoice: 'TEST/2026-27/0001', grants_access: true }),
};
res = await post({ action: 'check', gym_id: GYM, payment_id: PAY }); body = await res.json();
check('check: reads the payment as the owner (RLS)', calls[0].headers.authorization === 'Bearer owner-jwt');
const ap = calls.find((c) => c.url.endsWith('rpc/apply_saas_payment'));
check('check: applies with the service key and Razorpay\'s amount', ap?.headers.authorization === 'Bearer service' && ap.body.p_amount_paise === 99900 && ap.body.p_payment_id === 'pay_1');
check('check: returns paid, period and invoice', body.status === 'paid' && body.invoice === 'TEST/2026-27/0001');
calls = []; script['api.razorpay.com/v1/payment_links/plink_1'] = () => reply(200, { status: 'created', amount_paid: 0, payments: [] });
res = await post({ action: 'check', gym_id: GYM, payment_id: PAY }); body = await res.json();
check('check: unpaid link changes nothing', body.status === 'created' && !calls.some((c) => c.url.includes('apply_saas_payment')));

// reconcile and tick are for Xelorsoft admins only
calls = []; script = { 'rpc/is_platform_admin': () => reply(200, null) };
res = await post({ action: 'reconcile' });
check('reconcile: refused for gym owners', res.status === 403 && calls.length === 1);
calls = []; script = {
  'rpc/is_platform_admin': () => reply(200, 'admin'),
  '/rest/v1/saas_payments?status=eq.created': () => reply(200, [{ id: PAY, link_id: 'plink_1' }, { id: VER, link_id: 'plink_2' }]),
  'payment_links/plink_1': () => reply(200, { status: 'paid', amount_paid: 99900, payments: [{ payment_id: 'pay_1', status: 'captured' }] }),
  'payment_links/plink_2': () => reply(200, { status: 'expired' }),
  'rpc/apply_saas_payment': () => reply(200, { paid_until: 'x' }),
  [`/rest/v1/saas_payments?id=eq.${VER}`]: () => new Response(null, { status: 204 }),
};
res = await post({ action: 'reconcile' }); body = await res.json();
check('reconcile: applies paid links and closes expired ones', body.checked === 2 && body.applied === 1 && body.expired === 1);
calls = []; script = { 'rpc/is_platform_admin': () => reply(200, 'viewer') };
res = await post({ action: 'tick' });
check('tick: viewers cannot run the billing clock', res.status === 403);

// ============================================================ webhook
handler = null;
await import('../../supabase/functions/xs-billing-webhook/index.ts');
const hook = handler;
const sign = (raw, secret = 'whsec-1') => createHmac('sha256', secret).update(raw).digest('hex');
const event = { entity: 'event', event: 'payment_link.paid', created_at: 1795100000, payload: { payment_link: { entity: { id: 'plink_1', amount_paid: 99900, notes: { product: 'xs-gym' } } }, payment: { entity: { id: 'pay_1', amount: 99900 } } } };
const raw = JSON.stringify(event);
const send = (body, headers) => hook(new Request('https://x.invalid/functions/v1/xs-billing-webhook', { method: 'POST', headers, body }));

calls = []; script = { 'rpc/ingest_gateway_event': () => reply(200, { status: 'processed', applied: true }) };
res = await send(raw, { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_ABC123' });
const ing = calls[0];
check('webhook: valid signature is stored with the event id', res.status === 200 && ing?.body.p_event_id === 'evt_ABC123' && ing.body.p_event === 'payment_link.paid');
check('webhook: ingested with the service key', ing?.headers.authorization === 'Bearer service');
check('webhook: event time passed for ordering', ing?.body.p_created_at === new Date(1795100000 * 1000).toISOString());
calls = [];
res = await send(raw, { 'x-razorpay-signature': sign(raw, 'wrong-secret'), 'x-razorpay-event-id': 'evt_ABC123' });
check('webhook: bad signature refused, nothing stored', res.status === 401 && calls.length === 0);
calls = [];
res = await send(raw.replace('99900', '1'), { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_ABC124' });
check('webhook: tampered body refused', res.status === 401 && calls.length === 0);
res = await send(raw, { 'x-razorpay-event-id': 'evt_ABC125' });
check('webhook: missing signature refused', res.status === 401);
calls = [];
res = await send(raw, { 'x-razorpay-signature': sign(raw) });
check('webhook: without an event id header, a body hash is the id', res.status === 200 && /^sha256:[0-9a-f]{64}$/.test(calls[0]?.body.p_event_id));
script = { 'rpc/ingest_gateway_event': () => reply(200, { duplicate: true, status: 'processed' }) };
res = await send(raw, { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_ABC123' }); body = await res.json();
check('webhook: duplicate acknowledged (200) so Razorpay stops retrying', res.status === 200 && body.status === 'duplicate');
script = { 'rpc/ingest_gateway_event': () => reply(200, { status: 'failed', error: 'XS409' }) };
res = await send(raw, { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_ABC126' });
check('webhook: processing failure returns 500 so Razorpay retries', res.status === 500);
script = { 'rpc/ingest_gateway_event': () => reply(500, { message: 'db down' }) };
res = await send(raw, { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_ABC127' });
check('webhook: database outage returns 500 (retry)', res.status === 500);
ENV.RAZORPAY_WEBHOOK_SECRET = 'whsec-2'; ENV.RAZORPAY_WEBHOOK_SECRET_OLD = 'whsec-1';
script = { 'rpc/ingest_gateway_event': () => reply(200, { status: 'processed' }) };
res = await send(raw, { 'x-razorpay-signature': sign(raw, 'whsec-1'), 'x-razorpay-event-id': 'evt_ABC128' });
check('webhook: old secret accepted during rotation', res.status === 200);
delete ENV.RAZORPAY_WEBHOOK_SECRET; delete ENV.RAZORPAY_WEBHOOK_SECRET_OLD;
res = await send(raw, { 'x-razorpay-signature': sign(raw) });
check('webhook: no secret configured → 503, never accepts unsigned', res.status === 503);
res = await hook(new Request('https://x.invalid/', { method: 'GET' }));
check('webhook: POST only', res.status === 405);

out(failures ? `${failures} FAILED` : 'ALL BILLING FUNCTION CHECKS PASSED');
process.exit(failures ? 1 : 0);
