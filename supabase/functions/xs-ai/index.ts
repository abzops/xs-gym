// Supabase Edge Function: /functions/v1/xs-ai
//   POST { gym_id, messages: [{ role, content }], lang: 'en' | 'ml' } → agent reply
//   GET  → { configured, model } (no gym data; for setup checks)
// Secrets (Dashboard → Edge Functions → Secrets):
//   LLM_API_KEY   free key from Google AI Studio (Gemini), Groq or OpenRouter
//   LLM_MODEL     optional; by default the best available Gemini Flash model is picked
//   LLM_BASE_URL  optional; default is Gemini's OpenAI-compatible endpoint
import { ApiError, runAgent } from './agent.ts';

const ALLOWED_ORIGINS = ['https://abzops.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:4185'];
const BASE = (Deno.env.get('LLM_BASE_URL') ?? 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, '');
const KEY = Deno.env.get('LLM_API_KEY') ?? '';

let chosen: Promise<string> | null = null;
/** LLM_MODEL if set, else the newest general Flash model the key can use. */
function model(): Promise<string> {
  const fixed = Deno.env.get('LLM_MODEL');
  if (fixed) return Promise.resolve(fixed);
  chosen ??= (async () => {
    const r = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${KEY}` } });
    if (!r.ok) { chosen = null; throw new ApiError(r.status === 400 || r.status === 401 || r.status === 403 ? 'The AI key was rejected. Check LLM_API_KEY in Supabase.' : `Could not list AI models (${r.status}).`, 503); }
    const ids: string[] = ((await r.json()).data ?? []).map((m: { id: string }) => m.id.replace(/^models\//, ''));
    const usable = ids.filter((id) => /gemini/.test(id) && /flash/.test(id) && !/(lite|image|tts|audio|live|thinking|embedding|exp|preview)/.test(id));
    const pick = (list: string[]) => list.sort((a, b) => version(b) - version(a) || a.length - b.length)[0];
    const best = pick(usable) ?? pick(ids.filter((id) => /flash/.test(id) && !/(image|tts|audio|live|embedding)/.test(id))) ?? ids[0];
    if (!best) { chosen = null; throw new ApiError('No AI model is available for this key.', 503); }
    return best;
  })();
  return chosen;
}
const version = (id: string) => Number((/(\d+(?:\.\d+)?)/.exec(id) ?? ['0', '0'])[1]);

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  const cors = {
    'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    vary: 'origin',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
  if (!KEY) return json(503, { configured: false, error: 'XS AI is not set up yet. The owner needs to add an AI key in Supabase.' });

  try {
    if (req.method === 'GET') return json(200, { configured: true, model: await model() });
    if (req.method !== 'POST') return json(405, { error: 'GET or POST only' });
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const out = await runAgent(await req.json(), {
      supabaseUrl: Deno.env.get('SUPABASE_URL')!, anonKey: Deno.env.get('SUPABASE_ANON_KEY')!, userToken: token,
      llmApiKey: KEY, llmModel: await model(), llmBaseUrl: BASE,
    });
    return json(200, out);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    console.error('xs-ai', status, e instanceof Error ? e.message : e);
    return json(status, { error: e instanceof ApiError ? e.message : 'XS AI ran into a problem. Please try again.' });
  }
});
