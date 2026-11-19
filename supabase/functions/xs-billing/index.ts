// Supabase Edge Function: /functions/v1/xs-billing  (XS Gym subscription billing)
//   POST { action: 'start', gym_id, price, return_url } → { payment_id, url }
//        Makes a Razorpay payment link for the gym owner. The app sends the owner to `url`;
//        Razorpay sends them back to return_url (?billing=<payment_id>&razorpay_...).
//   POST { action: 'check', gym_id, payment_id }          → { status, paid_until? }
//        Asks Razorpay whether the link is paid and, if so, applies it (idempotent).
//
// The owner's permission is checked in the database as the signed-in user
// (prepare_saas_payment, and RLS on saas_payments). The service key only records the
// link and applies a payment after Razorpay itself says the link is paid; the browser's
// word is never trusted. Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET.

const ALLOWED_ORIGINS = ['https://gym.xelorsoft.com', 'https://abzops.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:4185'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RZP = 'https://api.razorpay.com/v1';

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const env = (k: string) => { try { return Deno.env.get(k)?.trim() || undefined; } catch { return undefined; } };

function errorFrom(body: unknown, fallback: string): string {
  const b = body as { message?: string; msg?: string; error?: unknown; hint?: string } | null;
  const e = b?.error as { description?: string } | string | undefined;
  return b?.message ?? b?.msg ?? (typeof e === 'string' ? e : e?.description) ?? fallback;
}

async function rest(path: string, init: RequestInit & { token?: string } = {}) {
  const service = !init.token;
  const key = service ? env('SUPABASE_SERVICE_ROLE_KEY') : env('SUPABASE_ANON_KEY');
  if (!key) throw new ApiError('XS503: payments are not set up on the server yet.', 503);
  const res = await fetch(`${env('SUPABASE_URL')}${path}`, {
    ...init,
    headers: {
      apikey: key, authorization: `Bearer ${init.token ?? key}`, 'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = errorFrom(body, `db ${res.status}`);
    if (/^XS\d{3}:/.test(msg)) {
      const code = Number(msg.slice(2, 5));
      throw new ApiError(msg, code === 401 ? 403 : [403, 404, 429].includes(code) ? code : 400);
    }
    if (/permission denied|JWT/i.test(msg)) throw new ApiError('XS403: only the gym owner can pay for XS Gym', 403);
    console.error('xs-billing db', path.split('?')[0], res.status, msg.slice(0, 200));
    throw new ApiError('XS500: could not save. Please try again.', 500);
  }
  return body;
}

function razorpayAuth() {
  const id = env('RAZORPAY_KEY_ID'), secret = env('RAZORPAY_KEY_SECRET');
  if (!id || !secret) throw new ApiError('XS503: online payment is not set up yet. Please contact Xelorsoft.', 503);
  return { id, header: `Basic ${btoa(`${id}:${secret}`)}`, mode: id.startsWith('rzp_live_') ? 'live' : 'test' };
}

async function razorpay(method: string, path: string, body?: unknown) {
  const auth = razorpayAuth();
  const res = await fetch(`${RZP}${path}`, {
    method,
    headers: { authorization: auth.header, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('xs-billing razorpay', method, path.split('/').slice(0, 2).join('/'), res.status, errorFrom(out, '').slice(0, 200));
    if (res.status === 401) throw new ApiError('XS503: online payment is not set up correctly. Please contact Xelorsoft.', 503);
    throw new ApiError('XS502: Razorpay did not respond. Please try again.', 502);
  }
  return out as Record<string, unknown>;
}

function safeReturnUrl(raw: unknown): URL {
  let u: URL;
  try { u = new URL(String(raw ?? '')); } catch { throw new ApiError('XS422: return address is missing', 400); }
  if (!ALLOWED_ORIGINS.includes(u.origin)) throw new ApiError('XS422: return address is not allowed', 400);
  return u;
}

type Prepared = {
  gym_id: string; gym_name: string; gym_phone: string | null; slug: string; user_id: string; email: string | null;
  price_code: string; label: string; months: number; amount_paise: number;
};

async function start(b: Record<string, unknown>, token: string) {
  const gym = String(b.gym_id ?? '');
  if (!UUID.test(gym)) throw new ApiError('XS422: gym is missing', 400);
  const ret = safeReturnUrl(b.return_url);
  const mode = razorpayAuth().mode;

  // 1. Permission and price, as the owner.
  const p = await rest('/rest/v1/rpc/prepare_saas_payment', {
    method: 'POST', token, body: JSON.stringify({ p_gym: gym, p_price: String(b.price ?? '') }),
  }) as Prepared;

  // 2. Record the attempt.
  const [row] = await rest('/rest/v1/saas_payments', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify({ gym_id: gym, price_code: p.price_code, months: p.months, amount_paise: p.amount_paise, created_by: p.user_id, mode }),
  }) as Array<{ id: string }>;

  // 3. Make the payment link. It returns to the app with ?billing=<row id>.
  ret.searchParams.set('billing', row.id);
  const contact = (p.gym_phone ?? '').replace(/[^\d+]/g, '');
  const link = await razorpay('POST', '/payment_links', {
    amount: p.amount_paise, currency: 'INR', accept_partial: false,
    reference_id: row.id,
    description: `XS Gym ${p.label} (${p.months} month${p.months > 1 ? 's' : ''}) for ${p.gym_name}`.slice(0, 2048),
    customer: {
      name: p.gym_name.slice(0, 80),
      ...(p.email && !p.email.endsWith('@staff.xelorsoft.com') ? { email: p.email } : {}),
      ...(/^\+?\d{10,13}$/.test(contact) ? { contact } : {}),
    },
    notify: { sms: false, email: false }, reminder_enable: false,
    expire_by: Math.floor(Date.now() / 1000) + 60 * 60,
    notes: { product: 'xs-gym', gym_id: gym, saas_payment_id: row.id, plan: p.price_code },
    callback_url: ret.toString(), callback_method: 'get',
  });
  const linkId = String(link.id ?? ''), url = String(link.short_url ?? '');
  if (!linkId || !url) throw new ApiError('XS502: Razorpay did not return a payment link. Please try again.', 502);
  await rest(`/rest/v1/saas_payments?id=eq.${row.id}`, {
    method: 'PATCH', body: JSON.stringify({ link_id: linkId, link_url: url }),
  });
  console.log('xs-billing start', gym, p.price_code, mode);
  return { payment_id: row.id, url };
}

async function check(b: Record<string, unknown>, token: string) {
  const id = String(b.payment_id ?? '');
  if (!UUID.test(id) || !UUID.test(String(b.gym_id ?? ''))) throw new ApiError('XS422: payment is missing', 400);
  // RLS: only the gym's owner can see the row.
  const rows = await rest(`/rest/v1/saas_payments?id=eq.${id}&gym_id=eq.${b.gym_id}&select=id,status,link_id,amount_paise,period_end`, { token }) as
    Array<{ id: string; status: string; link_id: string | null; amount_paise: number; period_end: string | null }>;
  const row = rows[0];
  if (!row) throw new ApiError('XS404: payment not found', 404);
  if (row.status === 'paid') return { status: 'paid', paid_until: row.period_end };
  if (!row.link_id) return { status: row.status };

  const link = await razorpay('GET', `/payment_links/${encodeURIComponent(row.link_id)}`);
  const status = String(link.status ?? '');
  if (status === 'paid') {
    const pays = (link.payments as Array<{ payment_id: string; status: string; amount: number }> | null) ?? [];
    const pay = pays.find((x) => x.status === 'captured') ?? pays[0];
    const r = await rest('/rest/v1/rpc/apply_saas_payment', {
      method: 'POST', body: JSON.stringify({ p_link_id: row.link_id, p_payment_id: pay?.payment_id ?? null, p_amount_paise: Number(link.amount_paid) }),
    }) as { paid_until: string };
    console.log('xs-billing paid (check)', b.gym_id);
    return { status: 'paid', paid_until: r.paid_until };
  }
  if (status === 'expired' || status === 'cancelled') {
    await rest(`/rest/v1/saas_payments?id=eq.${id}&status=eq.created`, { method: 'PATCH', body: JSON.stringify({ status }) });
    return { status };
  }
  return { status: 'created' };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
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
    if (body.action === 'start') return json(200, await start(body, token));
    if (body.action === 'check') return json(200, await check(body, token));
    if (body.action === 'status') return json(200, { configured: !!(env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET')), mode: env('RAZORPAY_KEY_ID')?.startsWith('rzp_live_') ? 'live' : 'test', webhook: !!env('RAZORPAY_WEBHOOK_SECRET') });
    throw new ApiError('XS400: unknown action', 400);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    if (!(e instanceof ApiError)) console.error('xs-billing', e instanceof Error ? e.message : e);
    return json(status, { error: e instanceof ApiError ? e.message : 'XS500: something went wrong. Please try again.' });
  }
});
