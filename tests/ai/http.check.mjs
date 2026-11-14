// XS AI HTTP contract and privacy smoke test. No live Supabase credentials,
// gym data or speech provider calls. Runs with Node's TypeScript stripping.

let handler;
globalThis.Deno = {
  env: { get: (key) => key === 'SUPABASE_URL' ? 'http://invalid.local'
    : key === 'SUPABASE_ANON_KEY' ? 'local-publishable' : undefined },
  serve: (fn) => { handler = fn; },
};
const originalFetch = globalThis.fetch;
let upstreamCalls = 0;
globalThis.fetch = async (url) => {
  upstreamCalls++;
  if (String(url).endsWith('/auth/v1/user')) return new Response('{}', { status: 401 });
  throw new Error('Unexpected external request: ' + String(url));
};
await import('../../supabase/functions/xs-ai/index.ts');

let failures = 0;
const check = (label, ok) => {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
};
const endpoint = 'https://xs.invalid/functions/v1/xs-ai';
const headers = { origin: 'https://abzops.github.io', 'content-type': 'application/json' };
const post = (value) => handler(new Request(endpoint, { method: 'POST', headers, body: JSON.stringify(value) }));
const responseJson = async (res) => ({ status: res.status, body: await res.json() });

const options = await handler(new Request(endpoint, { method: 'OPTIONS', headers }));
check('OPTIONS returns 204 and only the approved CORS origin', options.status === 204 &&
  options.headers.get('access-control-allow-origin') === 'https://abzops.github.io');

const health = await responseJson(await handler(new Request(endpoint, { method: 'GET', headers })));
check('health says approval is required and exposes no key',
  health.status === 200 && health.body.approval_required === true &&
  !JSON.stringify(health.body).includes('local-publishable'));

const audio = await responseJson(await post({ gym_id: 'ffffeeee-ffff-4fff-8fff-ffffffffffff', messages: [], audio: { data: 'UklGRg==', mime: 'audio/webm' } }));
check('voice without a configured speech key is refused with 503', audio.status === 503);
check('the voice request contacted no remote service', upstreamCalls === 0);

const approveNothing = await responseJson(await post({ gym_id: 'ffffeeee-ffff-4fff-8fff-ffffffffffff', approve: [] }));
check('an empty approval is rejected before sign-in', approveNothing.status === 400 && upstreamCalls === 0);

const approveSignedOut = await responseJson(await post({ gym_id: 'ffffeeee-ffff-4fff-8fff-ffffffffffff',
  approve: [{ id: 'ffffeeee-ffff-4fff-8fff-fffffffffff1', tool: 'record_payment', args: { member_id: 'x', amount_paise: 100, method: 'cash' } }] }));
check('an approval without a signed-in session returns 401 and changes nothing', approveSignedOut.status === 401 && upstreamCalls === 1);

const badShape = await responseJson(await post({ gym_id: 'ffffeeee-ffff-4fff-8fff-ffffffffffff', messages: null }));
check('malformed conversation yields 400 instead of crashing', badShape.status === 400);

const noGym = await responseJson(await post({ gym_id: 'bad', messages: [{ role: 'user', content: 'hello' }] }));
check('invalid gym ID is rejected without a provider call', noGym.status === 400 && upstreamCalls === 1);

const valid = await responseJson(await post({
  gym_id: 'ffffeeee-ffff-4fff-8fff-ffffffffffff',
  messages: [{ role: 'user', content: 'hello' }],
}));
check('missing signed-in session returns 401 before handling data', valid.status === 401 && upstreamCalls === 2);

const wrongVerb = await handler(new Request(endpoint, { method: 'PUT', headers }));
check('unsupported HTTP verbs return 405', wrongVerb.status === 405);

const malformed = await handler(new Request(endpoint, { method: 'POST', headers, body: 'not-json' }));
check('invalid JSON returns a controlled 400', malformed.status === 400);

globalThis.fetch = originalFetch;
delete globalThis.Deno;
console.log(failures ? failures + ' XS AI HTTP FAILURES' : 'XS AI HTTP OK');
process.exit(failures ? 1 : 0);
