// Supabase Edge Function: /functions/v1/xs-billing  (XS Gym subscription billing)
//   POST { action: 'start', gym_id, plan, cycle, return_url } → { payment_id, url, amount_paise, kind }
//        Prices the purchase in the database as the signed-in owner (prepare_saas_checkout),
//        records it, and makes a Razorpay payment link. The app sends the owner to `url`.
//        Older app builds send { price } instead of { plan, cycle } (legacy single price).
//   POST { action: 'check', gym_id, payment_id }  → { status, paid_until?, invoice? }
//        Asks Razorpay whether the link is paid and, if so, applies it (idempotent).
//   POST { action: 'reconcile' }                  → { checked, applied, expired }   (Xelorsoft admins)
//        Re-checks recent unfinished links with Razorpay; catches missed webhooks.
//   POST { action: 'tick' }                       → billing_tick() result          (Xelorsoft admins)
//   POST { action: 'status' }                     → { configured, mode, webhook }
//
// Trust: permissions and prices are decided in the database as the signed-in user.
// The service key only records a link and applies a payment after Razorpay itself
// says it is paid; the browser's word is never trusted. Provisional (draft) prices
// can only be paid with Razorpay TEST keys. Secrets: RAZORPAY_KEY_ID,
// RAZORPAY_KEY_SECRET (and RAZORPAY_WEBHOOK_SECRET for the webhook function).

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
      throw new ApiError(msg, code === 401 ? 403 : [403, 404, 409, 429, 503].includes(code) ? code : 400);
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
  return { id, header: `Basic ${btoa(`${id}:${secret}`)}`, mode: id.startsWith('rzp_live_') ? 'live' as const : 'test' as const };
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
  plan_id?: string; plan_name?: string; plan_version_id?: string; provisional?: boolean; cycle?: 'monthly' | 'annual';
  kind?: 'new' | 'renewal' | 'upgrade'; list_price_paise?: number; credit_paise?: number;
};

async function start(b: Record<string, unknown>, token: string) {
  const gym = String(b.gym_id ?? '');
  if (!UUID.test(gym)) throw new ApiError('XS422: gym is missing', 400);
  const ret = safeReturnUrl(b.return_url);
  const mode = razorpayAuth().mode;
  const tiered = typeof b.plan === 'string';

  // 1. Permission and price, decided by the database as the owner.
  const p = (tiered
    ? await rest('/rest/v1/rpc/prepare_saas_checkout', {
        method: 'POST', token, body: JSON.stringify({ p_gym: gym, p_plan: String(b.plan), p_cycle: String(b.cycle ?? '') }),
      })
    : await rest('/rest/v1/rpc/prepare_saas_payment', {
        method: 'POST', token, body: JSON.stringify({ p_gym: gym, p_price: String(b.price ?? '') }),
      })) as Prepared;
  if (p.provisional && mode === 'live') {
    throw new ApiError('XS503: these prices are not final yet. Payments open once Xelorsoft confirms pricing.', 503);
  }

  // 2. Record the attempt (service role; clients cannot insert payments).
  const [row] = await rest('/rest/v1/saas_payments', {
    method: 'POST', headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      gym_id: gym, price_code: p.price_code, months: p.months, amount_paise: p.amount_paise, created_by: p.user_id, mode,
      ...(tiered ? {
        plan_version_id: p.plan_version_id, billing_cycle: p.cycle, kind: p.kind,
        list_price_paise: p.list_price_paise, credit_paise: p.credit_paise ?? 0,
      } : {}),
    }),
  }) as Array<{ id: string }>;

  // 3. Make the payment link. It returns to the app with ?billing=<row id>.
  ret.searchParams.set('billing', row.id);
  const contact = (p.gym_phone ?? '').replace(/[^\d+]/g, '');
  const period = p.months >= 12 ? '12 months' : `${p.months} month${p.months > 1 ? 's' : ''}`;
  const what = tiered ? `XS Gym ${p.plan_name} (${period}${p.kind === 'upgrade' ? ', upgrade' : p.kind === 'renewal' ? ', renewal' : ''})` : `XS Gym ${p.label} (${period})`;
  const link = await razorpay('POST', '/payment_links', {
    amount: p.amount_paise, currency: 'INR', accept_partial: false,
    reference_id: row.id,
    description: `${what} for ${p.gym_name}`.slice(0, 2048),
    customer: {
      name: p.gym_name.slice(0, 80),
      ...(p.email && !p.email.endsWith('@staff.xelorsoft.com') ? { email: p.email } : {}),
      ...(/^\+?\d{10,13}$/.test(contact) ? { contact } : {}),
    },
    notify: { sms: false, email: false }, reminder_enable: false,
    expire_by: Math.floor(Date.now() / 1000) + 60 * 60,
    notes: {
      product: 'xs-gym', gym_id: gym, saas_payment_id: row.id,
      plan: tiered ? `${p.plan_id}:${p.cycle}` : p.price_code, kind: p.kind ?? 'legacy',
    },
    callback_url: ret.toString(), callback_method: 'get',
  });
  const linkId = String(link.id ?? ''), url = String(link.short_url ?? '');
  if (!linkId || !url) throw new ApiError('XS502: Razorpay did not return a payment link. Please try again.', 502);
  await rest(`/rest/v1/saas_payments?id=eq.${row.id}`, {
    method: 'PATCH', body: JSON.stringify({ link_id: linkId, link_url: url }),
  });
  console.log('xs-billing start', gym, tiered ? `${p.plan_id}:${p.cycle}:${p.kind}` : p.price_code, mode);
  return { payment_id: row.id, url, amount_paise: p.amount_paise, kind: p.kind ?? 'legacy', mode };
}

type Link = { status?: string; amount_paid?: number; payments?: Array<{ payment_id: string; status: string; amount: number }> | null };

/** Applies a link Razorpay says is paid. Amount comes from Razorpay, not the browser. */
async function applyIfPaid(linkId: string, link: Link) {
  const pays = link.payments ?? [];
  const pay = pays.find((x) => x.status === 'captured') ?? pays[0];
  return await rest('/rest/v1/rpc/apply_saas_payment', {
    method: 'POST', body: JSON.stringify({ p_link_id: linkId, p_payment_id: pay?.payment_id ?? null, p_amount_paise: Number(link.amount_paid) }),
  }) as { paid_until: string; invoice?: string; grants_access?: boolean };
}

async function check(b: Record<string, unknown>, token: string) {
  const id = String(b.payment_id ?? '');
  if (!UUID.test(id) || !UUID.test(String(b.gym_id ?? ''))) throw new ApiError('XS422: payment is missing', 400);
  // RLS: only the gym's owner can see the row.
  const rows = await rest(`/rest/v1/saas_payments?id=eq.${id}&gym_id=eq.${b.gym_id}&select=id,status,link_id,amount_paise,period_end,grants_access`, { token }) as
    Array<{ id: string; status: string; link_id: string | null; amount_paise: number; period_end: string | null; grants_access: boolean | null }>;
  const row = rows[0];
  if (!row) throw new ApiError('XS404: payment not found', 404);
  if (row.status === 'paid') return { status: 'paid', paid_until: row.period_end, grants_access: row.grants_access ?? true };
  if (!row.link_id) return { status: row.status };

  const link = await razorpay('GET', `/payment_links/${encodeURIComponent(row.link_id)}`) as Link;
  const status = String(link.status ?? '');
  if (status === 'paid') {
    const r = await applyIfPaid(row.link_id, link);
    console.log('xs-billing paid (check)', b.gym_id);
    return { status: 'paid', paid_until: r.paid_until, invoice: r.invoice, grants_access: r.grants_access ?? true };
  }
  if (status === 'expired' || status === 'cancelled') {
    await rest(`/rest/v1/saas_payments?id=eq.${id}&status=eq.created`, { method: 'PATCH', body: JSON.stringify({ status }) });
    return { status };
  }
  return { status: 'created' };
}

async function requireAdmin(token: string, min: 'admin' | 'viewer' = 'admin') {
  const role = await rest('/rest/v1/rpc/is_platform_admin', { method: 'POST', token, body: '{}' }) as string | null;
  if (!role || (min === 'admin' && role === 'viewer')) throw new ApiError('XS403: Xelorsoft admin access required', 403);
  return role;
}

async function reconcile(token: string) {
  await requireAdmin(token);
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const rows = await rest(`/rest/v1/saas_payments?status=eq.created&link_id=not.is.null&created_at=gte.${since}&select=id,link_id&order=created_at.asc&limit=100`) as
    Array<{ id: string; link_id: string }>;
  let applied = 0, expired = 0;
  for (const r of rows) {
    const link = await razorpay('GET', `/payment_links/${encodeURIComponent(r.link_id)}`) as Link;
    if (link.status === 'paid') { await applyIfPaid(r.link_id, link); applied++; }
    else if (link.status === 'expired' || link.status === 'cancelled') {
      await rest(`/rest/v1/saas_payments?id=eq.${r.id}&status=eq.created`, { method: 'PATCH', body: JSON.stringify({ status: link.status }) });
      expired++;
    }
  }
  console.log('xs-billing reconcile', rows.length, applied, expired);
  return { checked: rows.length, applied, expired };
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
    if (body.action === 'reconcile') return json(200, await reconcile(token));
    if (body.action === 'tick') { await requireAdmin(token); return json(200, await rest('/rest/v1/rpc/billing_tick', { method: 'POST', body: '{}' })); }
    if (body.action === 'status') return json(200, { configured: !!(env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET')), mode: env('RAZORPAY_KEY_ID')?.startsWith('rzp_live_') ? 'live' : 'test', webhook: !!env('RAZORPAY_WEBHOOK_SECRET') });
    throw new ApiError('XS400: unknown action', 400);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    if (!(e instanceof ApiError)) console.error('xs-billing', e instanceof Error ? e.message : e);
    return json(status, { error: e instanceof ApiError ? e.message : 'XS500: something went wrong. Please try again.' });
  }
});
