// Supabase Edge Function: /functions/v1/staff-login
//   POST { action: 'create', gym_id, name, phone, role } → { staff, username, password }
//   POST { action: 'reset',  gym_id, staff_id }          → { username, password, name, phone, role }
//
// The owner makes a login for a staff member; no email or sign-up is needed.
// Every permission check runs in the database as the signed-in owner
// (prepare_staff_login / attach_staff_login / prepare_staff_password_reset,
// migration 20261119080000). The service key is used only to create the auth
// account or set its password, and only after that check has passed.
// Passwords are generated here, returned once to the owner and never stored
// or logged by XS Gym.

const ALLOWED_ORIGINS = ['https://gym.xelorsoft.com', 'https://abzops.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:4185'];
const ROLES = ['manager', 'reception', 'trainer'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const env = (k: string) => { try { return Deno.env.get(k)?.trim() || undefined; } catch { return undefined; } };

/** Easy to read out and type on a phone: no 0/O, 1/l/I. e.g. "k7Qm-x3Fp". */
export function generatePassword(): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz', upper = 'ABCDEFGHJKMNPQRSTUVWXYZ', digits = '23456789';
  const all = lower + upper + digits;
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    // 54 characters; 216 = 54 * 4, so bytes ≥ 216 are skipped to keep every character equally likely.
    const chars: string[] = [];
    for (const b of bytes) if (b < 216) chars.push(all[b % all.length]);
    if (chars.length < 8) continue;
    const pw = chars.join('');
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[2-9]/.test(pw)) return `${pw.slice(0, 4)}-${pw.slice(4)}`;
  }
}

function errorFrom(body: unknown, fallback: string): string {
  const b = body as { message?: string; msg?: string; error_description?: string; error?: string } | null;
  return b?.message ?? b?.msg ?? b?.error_description ?? (typeof b?.error === 'string' ? b.error : undefined) ?? fallback;
}

async function rpcAsUser<T>(fn: string, args: Record<string, unknown>, token: string): Promise<T> {
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env('SUPABASE_ANON_KEY')!, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = errorFrom(body, 'Request failed');
    const status = /^XS403|^XS401|permission denied|JWT/i.test(msg) ? 403 : /^XS402/.test(msg) ? 402 : 400;
    throw new ApiError(/^XS\d{3}:/.test(msg) ? msg : status === 403 ? 'XS403: you do not have permission to do this' : 'XS500: could not save. Please try again.', status);
  }
  return body as T;
}

async function admin(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new ApiError('XS503: staff logins are not set up on the server yet.', 503);
  const res = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = errorFrom(out, `auth ${res.status}`);
    console.error('staff-login auth admin', method, res.status, msg.slice(0, 200));
    if (/already|exists|registered/i.test(msg)) throw new ApiError('XS409: that username was just taken. Please try again.', 409);
    throw new ApiError('XS502: the login could not be created. Please try again.', 502);
  }
  return out as Record<string, unknown>;
}

type Prepared = { username: string; email: string; name: string; phone: string; role: string };
type ResetTarget = { user_id: string; username: string; name: string; phone: string | null; role: string };

async function createLogin(b: Record<string, unknown>, token: string) {
  const gym = String(b.gym_id ?? '');
  const role = String(b.role ?? '');
  if (!UUID.test(gym)) throw new ApiError('XS422: gym is missing', 400);
  if (!ROLES.includes(role)) throw new ApiError('XS422: role must be manager, reception or trainer', 400);

  // 1. Permission + input checks as the owner; also picks the username.
  const p = await rpcAsUser<Prepared>('prepare_staff_login',
    { p_gym: gym, p_name: String(b.name ?? ''), p_phone: String(b.phone ?? ''), p_role: role }, token);

  // 2. Create the account. app_metadata can only be set with the service key.
  const password = generatePassword();
  const user = await admin('POST', '', {
    email: p.email, password, email_confirm: true,
    user_metadata: { display_name: p.name },
    app_metadata: { xs_staff_gym: gym, xs_staff_login: true },
  });
  const userId = String(user.id ?? '');

  // 3. Link it to the gym as the owner (audited). Undo the account if that fails.
  try {
    const staff = await rpcAsUser<Record<string, unknown>>('attach_staff_login', {
      p_gym: gym, p_user: userId, p_username: p.username, p_name: p.name, p_phone: p.phone, p_role: role,
    }, token);
    console.log('staff-login created', gym, role);
    return { staff, username: p.username, password };
  } catch (e) {
    await admin('DELETE', `/${userId}`).catch(() => console.error('staff-login rollback failed', userId));
    throw e;
  }
}

async function resetPassword(b: Record<string, unknown>, token: string) {
  const gym = String(b.gym_id ?? '');
  const staffId = String(b.staff_id ?? '');
  if (!UUID.test(gym) || !UUID.test(staffId)) throw new ApiError('XS422: staff member is missing', 400);
  const t = await rpcAsUser<ResetTarget>('prepare_staff_password_reset', { p_gym: gym, p_staff: staffId }, token);
  const password = generatePassword();
  await admin('PUT', `/${t.user_id}`, { password });
  console.log('staff-login reset', gym);
  return { username: t.username, password, name: t.name, phone: t.phone, role: t.role };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
  // Passwords in responses must never be cached anywhere.
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  try {
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new ApiError('XS401: sign in required', 401);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { throw new ApiError('XS400: request body must be JSON', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('XS400: request body must be a JSON object', 400);
    if (body.action === 'create') return json(200, await createLogin(body, token));
    if (body.action === 'reset') return json(200, await resetPassword(body, token));
    throw new ApiError('XS400: unknown action', 400);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    if (!(e instanceof ApiError)) console.error('staff-login', e instanceof Error ? e.message : e);
    return json(status, { error: e instanceof ApiError ? e.message : 'XS500: something went wrong. Please try again.' });
  }
});
