// Supabase Edge Function: /functions/v1/xs-ai
//   POST { gym_id, messages, lang }            → reply; changes come back as `pending` cards
//   POST { gym_id, messages, lang, audio }     → transcribe with Sarvam, then as above (+ `heard`)
//   POST { gym_id, approve: [{id, tool, args}] } → runs the approved changes as the signed-in user
//   GET                                        → which providers are configured (no gym data, no keys)
// Credentials live only in Supabase Edge Function Secrets.
//
// Speech: SARVAM_API_KEY (legacy names SARVAM_AI / "Sarvam AI" also read).
// Chat models, fastest first; requests are hedged so a slow provider is
// overtaken by the next one (see agent.ts):
//   GROQ_API_KEY            Groq (fastest, free tier)
//   GEMINI_API_KEY          Google Gemini Flash
//   SARVAM_API_KEY          Sarvam (best Malayalam)
//   NVIDIA_API_KEY          NVIDIA NIM
//   XAI_API_KEY             xAI Grok
import { ApiError, runAgent, type AgentRequest, type LlmProvider } from './agent.ts';

const ALLOWED_ORIGINS = ['https://abzops.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:4185'];
const env = (k: string) => { try { return Deno.env.get(k)?.trim() || undefined; } catch { return undefined; } };
const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const sarvamKey = () => env('SARVAM_API_KEY') ?? env('SARVAM_AI') ?? env('Sarvam AI') ?? env('SARVAM_KEY');

function configuredProviders(): LlmProvider[] {
  const out: LlmProvider[] = [];
  const add = (group: string, label: string, apiKey: string | undefined, baseUrl: string, models: (string | undefined)[], headers?: Record<string, string>) => {
    if (!apiKey) return;
    for (const model of uniq(models)) out.push({ name: `${label} / ${model}`, group, apiKey, baseUrl, model, headers });
  };
  add('groq', 'Groq', env('GROQ_API_KEY') ?? env('wisper'), 'https://api.groq.com/openai/v1',
    [env('GROQ_MODEL'), 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile']);
  const legacyBase = env('LLM_BASE_URL');
  if (legacyBase) add('custom', 'Custom', env('LLM_API_KEY'), legacyBase, [env('LLM_MODEL')]);
  add('gemini', 'Gemini', env('GEMINI_API_KEY') ?? (legacyBase ? undefined : env('LLM_API_KEY')),
    'https://generativelanguage.googleapis.com/v1beta/openai', [env('GEMINI_MODEL'), 'gemini-flash-latest', 'gemini-2.5-flash']);
  const sk = sarvamKey();
  if (sk) {
    add('sarvam', 'Sarvam', sk, 'https://api.sarvam.ai/v1', [env('SARVAM_MODEL'), 'sarvam-105b'], { 'api-subscription-key': sk });
    add('sarvam', 'Sarvam v2', sk, 'https://api.sarvam.ai/v2', ['deepseekv4-flash', 'gemma4'], { 'api-subscription-key': sk });
  }
  add('nvidia', 'NVIDIA NIM', env('NVIDIA_API_KEY'), 'https://integrate.api.nvidia.com/v1',
    [env('NVIDIA_MODEL'), 'openai/gpt-oss-20b', 'nvidia/nemotron-3.5-lightning-30b-a3b']);
  add('xai', 'xAI Grok', env('XAI_API_KEY') ?? env('GROK_API_KEY') ?? env('Grok'), 'https://api.x.ai/v1',
    [env('XAI_MODEL'), 'grok-4.3']);
  return out;
}

const MIME_EXT: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mpeg': 'mp3' };
const MAX_AUDIO_BASE64 = 2_800_000; // ≈ 2 MB, far more than 30 s of compressed speech

/** Sarvam speech to text. Audio goes only to Sarvam and is never stored or logged. */
async function sarvamTranscribe(audio: { data: string; mime: string }, lang: 'en' | 'ml'): Promise<string> {
  const key = sarvamKey();
  if (!key) throw new ApiError('Voice is not set up yet: add SARVAM_API_KEY in Supabase Edge Function secrets.', 503);
  const mime = audio.mime.split(';')[0].trim().toLowerCase();
  const ext = MIME_EXT[mime];
  if (!ext) throw new ApiError('unsupported audio format', 400);
  if (audio.data.length < 400 || audio.data.length > MAX_AUDIO_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.data))
    throw new ApiError('the recording is empty or too long (30 seconds at most)', 400);
  const binary = atob(audio.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const send = async (model: string) => {
    const form = new FormData();
    form.append('file', new Blob([bytes.buffer as ArrayBuffer], { type: mime }), `voice.${ext}`);
    form.append('model', model);
    form.append('language_code', lang === 'en' ? 'en-IN' : 'ml-IN');
    form.append('mode', 'transcribe');
    const started = Date.now();
    const res = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST', headers: { 'api-subscription-key': key }, body: form, signal: AbortSignal.timeout(15_000),
    });
    console.log('xs-ai stt', model, res.status, Date.now() - started, 'ms');
    return res;
  };
  let res = await send(env('SARVAM_STT_MODEL') ?? 'saaras:v3');
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    console.warn('xs-ai stt rejected', (await res.text().catch(() => '')).slice(0, 200));
    res = await send('saarika:v2.5');
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
    console.error('xs-ai stt failed', res.status, detail);
    if (res.status === 401 || res.status === 403) throw new ApiError('The Sarvam API key was rejected. Check SARVAM_API_KEY in Supabase secrets.', 502);
    if (res.status === 429) throw new ApiError('Voice is busy right now. Try again in a moment.', 429);
    throw new ApiError('Voice could not be understood right now. Please try again or type.', 502);
  }
  const out = await res.json() as { transcript?: unknown };
  return typeof out.transcript === 'string' ? out.transcript.trim().slice(0, 2000) : '';
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
  try {
    const providers = configuredProviders();
    if (req.method === 'GET') return json(200, {
      configured: providers.length > 0,
      voice: !!sarvamKey(),
      approval_required: true,
      providers: providers.map((p) => ({ name: p.name })),
    });
    if (req.method !== 'POST') return json(405, { error: 'GET or POST only' });
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    let body: AgentRequest;
    try { body = await req.json() as AgentRequest; }
    catch { return json(400, { error: 'Request body must be valid JSON.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return json(400, { error: 'Request body must be a JSON object.' });
    const started = Date.now();
    const out = await runAgent(body, { supabaseUrl, anonKey, userToken: token, providers, transcribe: sarvamKey() ? sarvamTranscribe : undefined });
    console.log('xs-ai done', body.approve ? 'approve' : body.audio ? 'voice' : 'text', Date.now() - started, 'ms');
    return json(200, out);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    console.error('xs-ai', status, e instanceof Error ? e.message : e);
    return json(status, { error: e instanceof ApiError ? e.message : 'XS AI ran into a problem. Please try again.' });
  }
});
