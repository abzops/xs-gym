// Supabase Edge Function: /functions/v1/xs-ai
//   POST { gym_id, messages, lang }         → agent reply (reads/changes data as the user)
//   POST { gym_id, transcribe: { audio, lang } } → { text } for authenticated gym staff
//   GET                                     → which providers are configured (no gym data)
// Credentials only live in Supabase Edge Function Secrets.
//
// Providers, fastest first. Requests are hedged: if one is slow, the next
// provider starts after 5 s and the first answer wins (see agent.ts).
//   GROQ_API_KEY                       Groq (fast; also Whisper speech-to-text)
//   GEMINI_API_KEY or LLM_API_KEY      Google Gemini (LLM_BASE_URL switches LLM_API_KEY to any OpenAI-compatible service)
//   NVIDIA_API_KEY                     NVIDIA NIM
//   XAI_API_KEY / GROK_API_KEY / Grok  xAI Grok (also voice transcription)
import { ApiError, runAgent, type LlmProvider } from './agent.ts';
import { SpeechUnavailableError, sttConfigured, transcribe, type SttEnv } from './stt.ts';

const ALLOWED_ORIGINS = ['https://abzops.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:4185'];
const env = (k: string) => Deno.env.get(k)?.trim() || undefined;
const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];

function configuredProviders(): LlmProvider[] {
  const out: LlmProvider[] = [];
  const add = (group: string, label: string, apiKey: string | undefined, baseUrl: string, models: (string | undefined)[]) => {
    if (!apiKey) return;
    for (const model of uniq(models)) out.push({ name: `${label} / ${model}`, group, apiKey, baseUrl, model });
  };
  add('groq', 'Groq', env('GROQ_API_KEY'), 'https://api.groq.com/openai/v1',
    [env('GROQ_MODEL'), 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile']);
  const legacyBase = env('LLM_BASE_URL');
  if (legacyBase) add('custom', 'Custom', env('LLM_API_KEY'), legacyBase, [env('LLM_MODEL')]);
  add('gemini', 'Gemini', env('GEMINI_API_KEY') ?? (legacyBase ? undefined : env('LLM_API_KEY')),
    'https://generativelanguage.googleapis.com/v1beta/openai', [env('GEMINI_MODEL') ?? env('LLM_MODEL'), 'gemini-flash-latest', 'gemini-2.5-flash']);
  // Smaller, faster NIM models first; all share one endpoint and key.
  add('nvidia', 'NVIDIA NIM', env('NVIDIA_API_KEY'), 'https://integrate.api.nvidia.com/v1',
    [env('NVIDIA_MODEL'), 'nvidia/nemotron-3.5-lightning-30b-a3b', 'openai/gpt-oss-20b', 'z-ai/glm-5.3-flash']);
  add('xai', 'xAI Grok', env('XAI_API_KEY') ?? env('GROK_API_KEY') ?? env('Grok'), 'https://api.x.ai/v1',
    [env('XAI_MODEL'), 'grok-4.3']);
  return out;
}

const sttEnv = (): SttEnv => ({
  groqKey: env('GROQ_API_KEY'),
  geminiKey: env('GEMINI_API_KEY') ?? (env('LLM_BASE_URL') ? undefined : env('LLM_API_KEY')),
  geminiModel: env('GEMINI_STT_MODEL'),
  xaiKey: env('XAI_API_KEY') ?? env('GROK_API_KEY') ?? env('Grok'),
  nvidiaKey: env('NVIDIA_API_KEY'),
});

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
      stt: sttConfigured(sttEnv()),
      stt_languages: { en: sttConfigured(sttEnv(), 'en'), ml: sttConfigured(sttEnv(), 'ml') },
      providers: providers.map((p) => ({ name: p.name })),
    });
    if (req.method !== 'POST') return json(405, { error: 'GET or POST only' });
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const body = await req.json();

    if (body?.transcribe) {
      // Speech is a billable server resource: verify both authentication and
      // ACTIVE gym membership with the caller's own JWT (never service-role).
      const authHeaders = { apikey: anonKey, authorization: `Bearer ${token}` };
      const who = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: authHeaders });
      if (!who.ok) throw new ApiError('Sign in to use voice.', 401);
      const user = await who.json() as { id?: string };
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const gymId = body.gym_id;
      if (!uuid.test(user.id ?? '') || typeof gymId !== 'string' || !uuid.test(gymId)) {
        throw new ApiError('Choose your gym before using voice.', 400);
      }
      const staff = await fetch(
        `${supabaseUrl}/rest/v1/gym_staff?select=role&gym_id=eq.${gymId}&user_id=eq.${user.id}&status=eq.active&limit=1`,
        { headers: authHeaders },
      );
      if (!staff.ok) throw new ApiError('Voice access could not be verified.', 403);
      const rows = await staff.json() as { role?: string }[];
      if (!Array.isArray(rows) || rows.length === 0) throw new ApiError('Voice is available only to staff in this gym.', 403);
      return json(200, { text: await transcribe(body.transcribe, sttEnv()) });
    }
    return json(200, await runAgent(body, { supabaseUrl, anonKey, userToken: token, providers }));
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    console.error('xs-ai', status, e instanceof Error ? e.message : e);
    return json(status, {
      error: e instanceof ApiError ? e.message : 'XS AI ran into a problem. Please try again.',
      ...(e instanceof SpeechUnavailableError
        ? { code: e.code, language: e.lang, retryable: e.retryable }
        : {}),
    });
  }
});
