// staff-login Edge Function contract: permission check runs first as the owner,
// accounts are rolled back on failure, passwords are never logged or cached.
// No live Supabase. Runs with Node's TypeScript stripping.

let handler;
globalThis.Deno = {
  env: { get: (k) => ({ SUPABASE_URL: 'http://sb.local', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' })[k] },
  serve: (fn) => { handler = fn; },
};

const GYM = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
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
const logs = [];
for (const k of ['log', 'warn', 'error']) { const orig = console[k]; console[k] = (...a) => { logs.push(a.join(' ')); if (k === 'log' && String(a[0]).startsWith('ok')) orig(...a); }; }
const out = (...a) => process.stdout.write(a.join(' ') + '\n');

await import('../../supabase/functions/staff-login/index.ts');

let failures = 0;
const check = (label, ok) => { if (!ok) failures++; out((ok ? 'ok   ' : 'FAIL ') + label); };
const post = (body, token = 'owner-jwt') => handler(new Request('https://x.invalid/functions/v1/staff-login', {
  method: 'POST', headers: { origin: 'https://gym.xelorsoft.com', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
}));
const prepared = { username: 'ravi.chaos', email: 'ravi.chaos@staff.xelorsoft.com', name: 'Ravi', phone: '+919876522222', role: 'reception' };

// --- happy path
calls = []; script = {
  'rpc/prepare_staff_login': () => reply(200, prepared),
  'admin/users': (c) => c.method === 'POST' ? reply(200, { id: USER }) : reply(500, {}),
  'rpc/attach_staff_login': () => reply(200, { id: STAFF, username: 'ravi.chaos' }),
};
let res = await post({ action: 'create', gym_id: GYM, name: 'Ravi', phone: '98765 22222', role: 'reception' });
let body = await res.json();
check('create returns username and password', res.status === 200 && body.username === 'ravi.chaos' && /^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/.test(body.password));
check('response is never cached', res.headers.get('cache-control') === 'no-store');
check('permission check runs first, as the owner', calls[0].url.endsWith('/rest/v1/rpc/prepare_staff_login') && calls[0].headers.authorization === 'Bearer owner-jwt' && calls[0].headers.apikey === 'anon');
const create = calls.find((c) => c.url.endsWith('/auth/v1/admin/users'));
check('account made with service key, confirmed, tagged to this gym', create?.headers.authorization === 'Bearer service' && create.body.email_confirm === true && create.body.app_metadata.xs_staff_gym === GYM && create.body.email === prepared.email);
check('account linked as the owner', calls[2].url.endsWith('/rpc/attach_staff_login') && calls[2].headers.authorization === 'Bearer owner-jwt' && calls[2].body.p_user === USER);
check('password never logged', !logs.some((l) => l.includes(body.password)));

// --- no permission: no account is made
calls = []; script = { 'rpc/prepare_staff_login': () => reply(400, { message: 'XS403: you do not have permission to do this' }) };
res = await post({ action: 'create', gym_id: GYM, name: 'Ravi', phone: '98765 22222', role: 'reception' }, 'desk-jwt');
body = await res.json();
check('reception is refused before any account is made', res.status === 403 && /XS403/.test(body.error) && !calls.some((c) => c.url.includes('/auth/v1/admin')));

// --- link fails: account rolled back
calls = []; script = {
  'rpc/prepare_staff_login': () => reply(200, prepared),
  'rpc/attach_staff_login': () => reply(400, { message: 'XS402: this gym\'s subscription has ended.' }),
  'admin/users': (c) => c.method === 'POST' ? reply(200, { id: USER }) : c.method === 'DELETE' ? reply(200, {}) : reply(500, {}),
};
res = await post({ action: 'create', gym_id: GYM, name: 'Ravi', phone: '98765 22222', role: 'reception' });
body = await res.json();
check('failed link deletes the new account', res.status === 402 && calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/admin/users/${USER}`)) && !('password' in body));

// --- input guards
calls = []; script = {};
res = await post({ action: 'create', gym_id: GYM, name: 'Ravi', phone: '98765 22222', role: 'owner' });
check('owner role refused without any call', res.status === 400 && calls.length === 0);
res = await post({ action: 'create', gym_id: GYM, name: 'Ravi', phone: '1', role: 'reception' }, '');
check('no token → 401', res.status === 401 && calls.length === 0);
res = await post({ action: 'drop' });
check('unknown action refused', res.status === 400);
res = await handler(new Request('https://x.invalid/functions/v1/staff-login', { method: 'GET', headers: { origin: 'https://evil.example' } }));
check('GET refused; foreign origin not echoed', res.status === 405 && res.headers.get('access-control-allow-origin') === 'https://gym.xelorsoft.com');

// --- reset
calls = []; script = {
  'rpc/prepare_staff_password_reset': () => reply(200, { user_id: USER, username: 'ravi.chaos', name: 'Ravi', phone: '+919876522222', role: 'reception' }),
  'admin/users': (c) => c.method === 'PUT' ? reply(200, { id: USER }) : reply(500, {}),
};
res = await post({ action: 'reset', gym_id: GYM, staff_id: STAFF });
body = await res.json();
check('reset checks as owner, then sets a new password', res.status === 200 && calls[0].headers.authorization === 'Bearer owner-jwt' && calls[1].method === 'PUT' && calls[1].body.password === body.password && body.username === 'ravi.chaos');

// --- remove
calls = []; script = {
  'rpc/remove_staff': () => reply(200, { user_id: USER, username: 'ravi.chaos' }),
  'admin/users': (c) => c.method === 'DELETE' ? reply(200, {}) : reply(500, {}),
};
res = await post({ action: 'remove', gym_id: GYM, staff_id: STAFF });
check('remove checks as owner, then deletes the made login', res.status === 200 && calls[0].headers.authorization === 'Bearer owner-jwt' && calls[1].method === 'DELETE' && calls[1].url.endsWith(`/admin/users/${USER}`));
calls = []; script = { 'rpc/remove_staff': () => reply(200, { user_id: USER, username: null }) };
res = await post({ action: 'remove', gym_id: GYM, staff_id: STAFF });
check('email staff: own account is never deleted', res.status === 200 && !calls.some((c) => c.url.includes('/auth/v1/admin')));
calls = []; script = { 'rpc/remove_staff': () => reply(400, { message: 'XS403: you do not have permission to do this' }) };
res = await post({ action: 'remove', gym_id: GYM, staff_id: STAFF }, 'desk-jwt');
check('reception cannot remove; nothing deleted', res.status === 403 && !calls.some((c) => c.url.includes('/auth/v1/admin')));

// --- passwords are varied and readable
script = {
  'rpc/prepare_staff_password_reset': () => reply(200, { user_id: USER, username: 'ravi.chaos', name: 'Ravi', phone: '+919876522222', role: 'reception' }),
  'admin/users': (c) => c.method === 'PUT' ? reply(200, { id: USER }) : reply(500, {}),
};
const many = new Set();
for (let i = 0; i < 300; i++) {
  calls = []; res = await post({ action: 'reset', gym_id: GYM, staff_id: STAFF }); many.add((await res.json()).password);
}
check('passwords are unique and avoid look-alike characters', many.size === 300 && [...many].every((p) => !/[01OIl]/.test(p)));

if (failures) { out(`${failures} staff-login check(s) failed`); process.exit(1); }
out('STAFF LOGIN CHECKS PASSED');
