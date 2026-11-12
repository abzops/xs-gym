// XS AI Malayalam speech relay. WebSocket handles live partials; authenticated
// REST handles recordings preserved locally during a failed browser attempt.
// Both transports remain disabled until production credentials are configured.
// Server-side realtime relay for Sarvam; the vendor API key NEVER enters the browser.
// Cloud audio is opt-in and this endpoint defaults to disabled.
const ALLOWED_ORIGINS = new Set([
  'https://abzops.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]);
const PROTOCOL = 'xsai-sarvam-v1';
const MAX_SESSION_MS = 35_000;
const MAX_AUDIO_BYTES = 25 * 16000 * 2; // at most 25 seconds of 16 kHz, mono, 16-bit PCM
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const env = (name: string) => Deno.env.get(name)?.trim() ?? '';
const fail = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json' } });

async function authorizedUser(token: string, gymId: string): Promise<boolean> {
  const supabaseUrl = env('SUPABASE_URL');
  const publishable = env('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !publishable) return false;
  const headers = { 'apikey': publishable, 'authorization': 'Bearer ' + token };
  const auth = await fetch(supabaseUrl + '/auth/v1/user', {
    headers, signal: AbortSignal.timeout(5000),
  });
  if (!auth.ok) return false;
  const user = await auth.json() as { id?: string };
  if (!user.id || !uuid.test(user.id)) return false;
  const params = new URLSearchParams({
    select: 'user_id', gym_id: 'eq.' + gymId, user_id: 'eq.' + user.id, status: 'eq.active', limit: '1',
  });
  // All table reads are evaluated under the CALLER'S JWT and its RLS.
  const staff = await fetch(supabaseUrl + '/rest/v1/gym_staff?' + params, {
    headers, signal: AbortSignal.timeout(5000),
  });
  if (!staff.ok) return false;
  const rows = await staff.json() as Array<{ user_id: string }>;
  return Array.isArray(rows) && rows.length === 1 && rows[0].user_id === user.id;
}

const MAX_UPLOAD_BASE64 = 2_800_000; // 2 MiB decoded, no arbitrary-length audio uploads
const SarvamModel = 'saaras:v4';

const corsHeaders = (origin: string) => ({
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'vary': 'Origin',
  ...(ALLOWED_ORIGINS.has(origin) ? {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  } : {}),
});
const json = (status: number, value: unknown, origin: string) =>
  new Response(JSON.stringify(value), { status, headers: corsHeaders(origin) });
// A legacy secret was entered under its dashboard display label rather than
// the environment variable name the relay expected. Read the exact legacy
// names securely on the server, without ever echoing the value to the client.
// Do not silently re-enable a relay that the owner explicitly disabled.
const vendorKey = (): string => {
  for (const name of ['SARVAM_API_KEY', 'SARVAM_AI', 'Sarvam AI']) {
    try {
      const value = env(name);
      if (value) return value;
    } catch { /* unsupported legacy variable name */ }
  }
  return '';
};
const relayEnabled = (): boolean => {
  const flag = env('SARVAM_STT_ENABLED');
  return flag === 'true' || (flag === '' && !!vendorKey());
};
const relayReady = () => relayEnabled() && !!vendorKey();

/** Authenticated small-clip fallback. Audio remains on device if native
 * browser recognition succeeded; only failed sessions reach this endpoint.
 * Never logs the user's voice, transcript, API key or Authorization header. */
async function transcribeRecording(req: Request, origin: string, vendorKey: string): Promise<Response> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (token.length < 20 || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    return json(401, { code: 'unauthorized' }, origin);
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > MAX_UPLOAD_BASE64 + 1024) return json(413, { code: 'clip_too_large' }, origin);
  let body: { gym_id?: unknown; lang?: unknown; audio?: unknown; mime?: unknown; duration_ms?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_UPLOAD_BASE64 + 1024) return json(413, { code: 'clip_too_large' }, origin);
    body = JSON.parse(raw);
  } catch {
    return json(400, { code: 'invalid_request' }, origin);
  }
  const gymId = typeof body.gym_id === 'string' ? body.gym_id : '';
  const mime = typeof body.mime === 'string' ? body.mime.split(';')[0].toLowerCase() : '';
  const audio = typeof body.audio === 'string' ? body.audio : '';
  const extension = ({ 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3' } as Record<string, string>)[mime];
  if (!uuid.test(gymId) || body.lang !== 'ml-IN' || !extension || !audio ||
      audio.length > MAX_UPLOAD_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio) ||
      typeof body.duration_ms !== 'number' || !Number.isFinite(body.duration_ms) ||
      body.duration_ms < 100 || body.duration_ms > 30000)
    return json(400, { code: 'invalid_audio' }, origin);
  try {
    if (!await authorizedUser(token, gymId)) return json(403, { code: 'not_gym_staff' }, origin);
  } catch {
    return json(503, { code: 'authentication_unavailable' }, origin);
  }
  let bytes: Uint8Array;
  try {
    const binary = atob(audio);
    if (binary.length < 300 || binary.length > 2_100_000)
      return json(400, { code: 'invalid_audio' }, origin);
    bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  } catch { return json(400, { code: 'invalid_audio' }, origin); }

  const form = new FormData();
  // Deno BlobPart requires an ArrayBuffer (not Uint8Array<ArrayBufferLike>).
  const safeBuffer = new ArrayBuffer(bytes.length);
  new Uint8Array(safeBuffer).set(bytes);
  form.append('file', new Blob([safeBuffer], { type: mime }), 'xs-ai-voice.' + extension);
  form.append('model', SarvamModel);
  form.append('language_code', 'ml-IN');
  form.append('mode', 'transcribe'); // Malayalam script, NOT transliterated Roman text
  form.append('keyterms', JSON.stringify(['XS Gym', 'UPI', 'മെമ്പർഷിപ്പ്', 'കുടിശ്ശിക', 'കളക്ഷൻ']));
  try {
    const res = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST', headers: { 'api-subscription-key': vendorKey }, body: form,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      // Provider error text can contain secrets/audio; never echo or log it.
      console.warn('xs-ai-sarvam REST provider status', res.status);
      return json(res.status === 429 ? 429 : 502, {
        code: res.status === 429 ? 'speech_rate_limited' : 'speech_provider_unavailable',
      }, origin);
    }
    const result = await res.json() as { transcript?: unknown; request_id?: unknown };
    const text = typeof result.transcript === 'string' ? result.transcript.trim().slice(0, 2000) : '';
    return json(200, {
      text, lang: 'ml-IN', model: SarvamModel,
      request_id: typeof result.request_id === 'string' ? result.request_id : null,
    }, origin);
  } catch {
    return json(504, { code: 'speech_timeout' }, origin);
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') ?? '';
  if (!ALLOWED_ORIGINS.has(origin)) return json(403, { code: 'origin_not_allowed' }, origin);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method === 'GET' && request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    // No credential values and no customer data; a real production readiness
    // signal distinguishes deployed-but-disabled from working speech service.
    return json(200, {
      provider: 'sarvam', ready: relayReady(),
      enabled: relayEnabled(),
      key_configured: !!vendorKey(),
      language: 'ml-IN', model: SarvamModel, max_seconds: 30,
    }, origin);
  }
  if (!relayReady()) return json(503, { code: 'speech_not_configured' }, origin);
  const key = vendorKey();
  if (request.method === 'POST') return transcribeRecording(request, origin, key);
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
    return json(426, { code: 'websocket_required' }, origin);
  const offered = (request.headers.get('sec-websocket-protocol') ?? '')
    .split(',').map((s) => s.trim());
  const jwtProtocol = offered.find((s) => s.startsWith('jwt.'));
  const token = jwtProtocol?.slice(4) ?? '';
  if (!offered.includes(PROTOCOL) || token.length < 20 || token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    return fail(401, 'Authentication required');
  const params = new URL(request.url).searchParams;
  const gymId = params.get('gym_id') ?? '';
  const lang = params.get('lang') ?? '';
  if (!uuid.test(gymId) || !['ml-IN', 'en-IN'].includes(lang))
    return fail(400, 'Invalid voice session');
  try {
    if (!await authorizedUser(token, gymId)) return fail(403, 'Not authorized for this gym');
  } catch {
    return fail(503, 'Authentication service unavailable');
  }

  // The constant protocol is the only subprotocol echoed, never the JWT.
  const { socket, response } = Deno.upgradeWebSocket(request, { protocol: PROTOCOL, idleTimeout: 40 });
  let upstream: WebSocket | null = null;
  let ready = false;
  let ended = false;
  let inputBytes = 0;
  let closed = false;
  let resolveClose!: () => void;
  const lifetime = new Promise<void>((resolve) => { resolveClose = resolve; });
  const runtime = globalThis as unknown as { EdgeRuntime?: { waitUntil: (work: Promise<void>) => void } };
  runtime.EdgeRuntime?.waitUntil(lifetime);
  const send = (message: object) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    try { upstream?.close(); } catch { /* already closed */ }
    try { socket.close(); } catch { /* already closed */ }
    resolveClose();
  };
  const timeout = setTimeout(() => { send({ event: 'error', message: 'Voice session timed out' }); cleanup(); }, MAX_SESSION_MS);
  socket.onopen = () => {
    try {
      const url = new URL('wss://api.sarvam.ai/speech-to-text-realtime/ws');
      url.searchParams.set('model', 'saaras:v4');
      url.searchParams.set('language_code', lang);
      url.searchParams.set('mode', 'transcribe');
      url.searchParams.set('stream_type', 'fast');
      url.searchParams.set('endpointing', 'manual');
      url.searchParams.set('sample_rate', '16000');
      url.searchParams.set('encoding', 'linear16');
      url.searchParams.set('prompt', 'Malayalam speech for XS Gym. Membership, renewals, dues, collection, UPI, cash, അംഗത്വം, കുടിശ്ശിക, കളക്ഷൻ.');
      // Outbound custom headers are supported by Deno's server-side WebSocket API.
      upstream = new WebSocket(url.toString(), {
        headers: { 'api-subscription-key': key },
      });
      upstream.onopen = () => {
        ready = true;
        send({ event: 'ready' });
      };
      upstream.onmessage = (evt: MessageEvent) => {
        let parsed: { event?: string; text?: string; message?: string; is_fatal?: boolean };
        try { parsed = JSON.parse(String(evt.data)); } catch { return; }
        if (parsed.event === 'transcript.partial' || parsed.event === 'transcript.final') {
          send({ event: parsed.event, text: typeof parsed.text === 'string' ? parsed.text.slice(0, 2000) : '' });
        } else if (parsed.event === 'error') {
          // Do not echo untrusted provider text or sensitive transcript diagnostics.
          send({ event: 'error', message: 'Speech recognition failed' });
          if (parsed.is_fatal) cleanup();
        }
      };
      upstream.onerror = () => { send({ event: 'error', message: 'Speech service unavailable' }); cleanup(); };
      upstream.onclose = () => { if (!closed) { send({ event: 'closed' }); cleanup(); } };
    } catch {
      send({ event: 'error', message: 'Speech service unavailable' });
      cleanup();
    }
  };
  socket.onmessage = (evt: MessageEvent) => {
    if (!ready || !upstream || upstream.readyState !== WebSocket.OPEN || ended || typeof evt.data !== 'string') return;
    if (evt.data.length > 25_000) { send({ event: 'error', message: 'Audio chunk too large' }); cleanup(); return; }
    let message: { event?: string; audio?: string };
    try { message = JSON.parse(evt.data); } catch { return; }
    if (message.event === 'audio_input') {
      if (typeof message.audio !== 'string' || message.audio.length > 24_000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(message.audio)) { cleanup(); return; }
      inputBytes += Math.floor(message.audio.length * 3 / 4);
      if (inputBytes > MAX_AUDIO_BYTES) { send({ event: 'error', message: 'Voice command too long' }); cleanup(); return; }
      upstream.send(JSON.stringify({ event: 'audio_input', audio: message.audio }));
    } else if (message.event === 'speech_start') {
      upstream.send(JSON.stringify({ event: 'speech_start' }));
    } else if (message.event === 'speech_end') {
      ended = true;
      upstream.send(JSON.stringify({ event: 'speech_end' }));
      upstream.send(JSON.stringify({ event: 'flush' }));
    }
  };
  socket.onerror = cleanup;
  socket.onclose = cleanup;
  return response;
});
