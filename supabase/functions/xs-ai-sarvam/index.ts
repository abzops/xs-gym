// Prototype only. DO NOT DEPLOY TO PRODUCTION until approved, tested and enabled.
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

Deno.serve(async (request: Request) => {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket')
    return fail(426, 'WebSocket required');
  // The pilot must opt in on both the browser AND the server; no free anonymous proxy.
  if (env('SARVAM_STT_ENABLED') !== 'true') return fail(503, 'Cloud speech not enabled');
  if (!ALLOWED_ORIGINS.has(request.headers.get('origin') ?? ''))
    return fail(403, 'Origin not allowed');
  const vendorKey = env('SARVAM_API_KEY');
  if (!vendorKey) return fail(503, 'Cloud speech not configured');
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
      url.searchParams.set('mode', 'codemix');
      url.searchParams.set('stream_type', 'fast');
      url.searchParams.set('endpointing', 'manual');
      url.searchParams.set('sample_rate', '16000');
      url.searchParams.set('encoding', 'linear16');
      // Outbound custom headers are supported by Deno's server-side WebSocket API.
      upstream = new WebSocket(url.toString(), {
        headers: { 'api-subscription-key': vendorKey },
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
