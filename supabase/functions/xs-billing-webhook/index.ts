// Supabase Edge Function: /functions/v1/xs-billing-webhook  (Razorpay → XS Gym)
// Deployed with verify_jwt = false: the caller is proven by X-Razorpay-Signature
// (HMAC-SHA256 of the raw body with RAZORPAY_WEBHOOK_SECRET, compared in constant time).
// RAZORPAY_WEBHOOK_SECRET_OLD, if set, is also accepted while a rotated secret settles.
//
// Every event goes to ingest_gateway_event (service role), which:
//  - stores it once per x-razorpay-event-id (a replay or retry of a processed
//    event does nothing; a failed one is processed again when Razorpay retries),
//  - applies payment_link.paid / expired / cancelled, payment.failed, refund.*,
//    payment.dispute.* in an order-safe way, and ignores other products' events.
// Replies 200 when stored (processed, ignored or duplicate) and 500 when
// processing failed, so Razorpay retries it.

const env = (k: string) => { try { return Deno.env.get(k)?.trim() || undefined; } catch { return undefined; } };

export async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const secrets = [env('RAZORPAY_WEBHOOK_SECRET'), env('RAZORPAY_WEBHOOK_SECRET_OLD')].filter(Boolean) as string[];
  if (!secrets.length) { console.error('xs-billing-webhook: RAZORPAY_WEBHOOK_SECRET not set'); return reply(503, { error: 'not configured' }); }

  const raw = await req.text();
  if (raw.length > 256_000) return reply(413, { error: 'too large' });
  const given = (req.headers.get('x-razorpay-signature') ?? '').toLowerCase();
  let valid = false;
  for (const s of secrets) if (given && sameHex(await hmacHex(s, raw), given)) valid = true;
  if (!valid) return reply(401, { error: 'bad signature' });

  let evt: { event?: string; created_at?: number; payload?: Record<string, unknown> };
  try { evt = JSON.parse(raw); } catch { return reply(400, { error: 'bad json' }); }
  if (!evt || typeof evt.event !== 'string') return reply(400, { error: 'no event' });

  const headerId = req.headers.get('x-razorpay-event-id') ?? '';
  const eventId = /^[A-Za-z0-9_.:-]{6,200}$/.test(headerId) ? headerId : `sha256:${await sha256Hex(raw)}`;
  const created = typeof evt.created_at === 'number' ? new Date(evt.created_at * 1000).toISOString() : null;

  const key = env('SUPABASE_SERVICE_ROLE_KEY')!;
  const res = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/ingest_gateway_event`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_event_id: eventId, p_event: evt.event, p_payload: evt.payload ?? {}, p_created_at: created }),
  });
  const out = await res.json().catch(() => null) as { status?: string; duplicate?: boolean; error?: string; message?: string } | null;
  if (!res.ok) {
    console.error('xs-billing-webhook ingest', res.status, String(out?.message ?? '').slice(0, 200));
    return reply(500, { error: 'not stored' });          // Razorpay retries
  }
  if (out?.status === 'failed') {
    console.error('xs-billing-webhook failed', evt.event, eventId, String(out.error ?? '').slice(0, 200));
    return reply(500, { error: 'processing failed' });   // Razorpay retries; event kept for admins
  }
  console.log('xs-billing-webhook', evt.event, out?.duplicate ? 'duplicate' : out?.status ?? 'ok');
  return reply(200, { ok: true, status: out?.duplicate ? 'duplicate' : out?.status });
});
