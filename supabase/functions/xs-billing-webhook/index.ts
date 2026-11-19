// Supabase Edge Function: /functions/v1/xs-billing-webhook  (Razorpay → XS Gym)
// Razorpay calls this when a payment link is paid, so a subscription is applied even
// if the owner closes the browser before returning to the app. Deployed with
// verify_jwt = false: the caller is proven by the X-Razorpay-Signature header
// (HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET).
// Events used: payment_link.paid. Links that are not XS Gym subscriptions (other
// Xelorsoft products on the same Razorpay account) are acknowledged and ignored.

const env = (k: string) => { try { return Deno.env.get(k)?.trim() || undefined; } catch { return undefined; } };

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const secret = env('RAZORPAY_WEBHOOK_SECRET');
  if (!secret) { console.error('xs-billing-webhook: RAZORPAY_WEBHOOK_SECRET not set'); return reply(503, { error: 'not configured' }); }

  const raw = await req.text();
  const given = (req.headers.get('x-razorpay-signature') ?? '').toLowerCase();
  if (!given || !sameHex(await hmacHex(secret, raw), given)) return reply(401, { error: 'bad signature' });

  let evt: { event?: string; payload?: Record<string, { entity?: Record<string, unknown> }> };
  try { evt = JSON.parse(raw); } catch { return reply(400, { error: 'bad json' }); }
  if (evt.event !== 'payment_link.paid') return reply(200, { ignored: evt.event ?? 'unknown' });

  const link = evt.payload?.payment_link?.entity ?? {};
  const pay = evt.payload?.payment?.entity ?? {};
  const notes = (link.notes ?? {}) as Record<string, string>;
  if (notes.product && notes.product !== 'xs-gym') return reply(200, { ignored: 'other product' });

  const key = env('SUPABASE_SERVICE_ROLE_KEY')!;
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/apply_saas_payment`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_link_id: String(link.id ?? ''), p_payment_id: pay.id ? String(pay.id) : null, p_amount_paise: Number(link.amount_paid ?? pay.amount) }),
  });
  const out = await res.json().catch(() => null) as { message?: string } | null;
  if (!res.ok) {
    const msg = out?.message ?? `db ${res.status}`;
    if (/^XS404/.test(msg)) return reply(200, { ignored: 'unknown link' });
    console.error('xs-billing-webhook apply', res.status, msg.slice(0, 200));
    return reply(500, { error: 'apply failed' }); // Razorpay retries
  }
  console.log('xs-billing paid (webhook)', notes.gym_id ?? '');
  return reply(200, { ok: true });
});
