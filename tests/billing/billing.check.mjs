// xs-billing + xs-billing-webhook contract: with Razorpay test keys, only Xelorsoft
// test gyms can pay; a real gym never gets a test link, and a refused test payment
// is acknowledged so Razorpay stops retrying. No live Supabase or Razorpay.

const out = (...a) => process.stdout.write(a.join(' ') + '\n');
let failures = 0;
const check = (label, ok) => { if (!ok) failures++; out((ok ? 'ok   ' : 'FAIL ') + label); };
for (const k of ['log', 'warn', 'error']) console[k] = () => {};

const GYM = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';
const handlers = [];
let envs = {};
globalThis.Deno = { env: { get: (k) => envs[k] }, serve: (fn) => { handlers.push(fn); } };

let calls = [];
let script = {};
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
  for (const [k, fn] of Object.entries(script)) if (u.includes(k)) return fn();
  throw new Error('Unexpected request ' + u);
};

await import('../../supabase/functions/xs-billing/index.ts');
await import('../../supabase/functions/xs-billing-webhook/index.ts');
const [billing, webhook] = handlers;

const base = { SUPABASE_URL: 'http://sb.local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', RAZORPAY_KEY_SECRET: 'sec', RAZORPAY_WEBHOOK_SECRET: 'whsec' };
const start = () => billing(new Request('https://x.invalid/functions/v1/xs-billing', {
  method: 'POST', headers: { origin: 'https://gym.xelorsoft.com', authorization: 'Bearer owner-jwt', 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'start', gym_id: GYM, price: 'monthly', return_url: 'https://gym.xelorsoft.com/g/chaos-combat/settings' }),
}));
const prepared = (test) => ({ gym_id: GYM, gym_name: 'CHAOS COMBAT', gym_phone: '+919876500000', slug: 'chaos-combat', user_id: 'u1', email: 'o@x.in',
  price_code: 'monthly', label: 'Monthly', months: 1, amount_paise: 49900, billing_test: test });
const linkScript = (test) => ({
  'rpc/prepare_saas_payment': () => reply(200, prepared(test)),
  'rest/v1/saas_payments?id=eq.': () => reply(200, []),
  'rest/v1/saas_payments': () => reply(201, [{ id: ROW }]),
  'api.razorpay.com/v1/payment_links': () => reply(200, { id: 'plink_1', short_url: 'https://rzp.io/x' }),
});

// Test keys + real gym → refused before anything is recorded or sent to Razorpay
envs = { ...base, RAZORPAY_KEY_ID: 'rzp_test_abc' };
calls = []; script = linkScript(false);
let res = await start(); let body = await res.json();
check('test keys: real gym refused (503)', res.status === 503 && /not open yet/.test(body.error));
check('test keys: nothing recorded, no Razorpay call', !calls.some((c) => c.url.includes('saas_payments') || c.url.includes('razorpay')));

// Test keys + Xelorsoft test gym → link made
calls = []; script = linkScript(true);
res = await start(); body = await res.json();
check('test keys: test gym gets a link', res.status === 200 && body.url === 'https://rzp.io/x');

// Live keys + real gym → link made, recorded as live
envs = { ...base, RAZORPAY_KEY_ID: 'rzp_live_abc' };
calls = []; script = linkScript(false);
res = await start(); body = await res.json();
const rec = calls.find((c) => c.url.endsWith('/rest/v1/saas_payments') && c.method === 'POST');
check('live keys: real gym gets a link recorded as live', res.status === 200 && rec?.body.mode === 'live');

// Webhook
async function sign(secret, raw) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw))), (b) => b.toString(16).padStart(2, '0')).join('');
}
const evt = JSON.stringify({ event: 'payment_link.paid', payload: { payment_link: { entity: { id: 'plink_1', amount_paid: 49900, notes: { product: 'xs-gym', gym_id: GYM } } }, payment: { entity: { id: 'pay_1', amount: 49900 } } } });
const hook = async (raw, sig) => webhook(new Request('https://x.invalid/functions/v1/xs-billing-webhook', { method: 'POST', headers: { 'x-razorpay-signature': sig }, body: raw }));

calls = []; script = {};
res = await hook(evt, 'deadbeef');
check('webhook: bad signature refused, nothing applied', res.status === 401 && calls.length === 0);

calls = []; script = { 'rpc/apply_saas_payment': () => reply(400, { message: 'XS403: a test-mode payment cannot be applied to this gym' }) };
res = await hook(evt, await sign('whsec', evt));
check('webhook: refused test payment acknowledged (no retry loop)', res.status === 200 && (await res.json()).ignored === 'refused');

calls = []; script = { 'rpc/apply_saas_payment': () => reply(200, { applied: true }) };
res = await hook(evt, await sign('whsec', evt));
check('webhook: valid paid event applied', res.status === 200 && calls[0].body.p_link_id === 'plink_1' && calls[0].body.p_amount_paise === 49900);

calls = []; script = { 'rpc/apply_saas_payment': () => reply(500, { message: 'db down' }) };
res = await hook(evt, await sign('whsec', evt));
check('webhook: real failure returns 500 so Razorpay retries', res.status === 500);

if (failures) { out(`${failures} billing check(s) failed`); process.exit(1); }
out('BILLING FUNCTION CHECKS PASSED');
