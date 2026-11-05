// Authenticated gym operations with ordered model-provider failover.
// Provider credentials must only be set in Supabase Edge Function Secrets.
import { ApiError, runAgent, type LlmProvider } from './agent.ts';

const ALLOWED_ORIGINS = ['https://abzops.github.io', 'http://localhost:5173', 'http://localhost:4173', 'http://localhost:4185'];

// NVIDIA NIM -> xAI Grok -> optional OpenAI-compatible provider.
function configuredProviders(): LlmProvider[] {
  const providers: LlmProvider[] = [];
  const nvidiaKey = Deno.env.get('NVIDIA_API_KEY');
  // Accept the existing dashboard secret name `Grok` as well as standard names.
  const xaiKey = Deno.env.get('XAI_API_KEY') || Deno.env.get('GROK_API_KEY') || Deno.env.get('Grok');
  const legacyKey = Deno.env.get('LLM_API_KEY');
  // Try multiple documented NIM models; a 410 means model retirement.
  if (nvidiaKey) {
    const preferred = Deno.env.get('NVIDIA_MODEL')?.trim();
    const candidates = [...new Set([
      preferred, 'openai/gpt-oss-20b',
      'nvidia/nemotron-3.5-lightning-30b-a3b',
      'z-ai/glm-5.3-flash',
    ].filter((model): model is string => !!model))];
    for (const model of candidates) providers.push({
      name: `NVIDIA NIM / ${model}`, group: 'nvidia', apiKey: nvidiaKey,
      baseUrl: 'https://integrate.api.nvidia.com/v1', model,
    });
  }
  if (xaiKey) providers.push({
    name: 'xAI Grok', group: 'xai', apiKey: xaiKey,
    baseUrl: 'https://api.x.ai/v1',
    model: Deno.env.get('XAI_MODEL') || 'grok-4.3',
  });
  if (legacyKey) providers.push({
    name: 'Additional', group: 'additional', apiKey: legacyKey,
    baseUrl: Deno.env.get('LLM_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: Deno.env.get('LLM_MODEL') || 'gemini-2.5-flash',
  });
  return providers;
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
      providers: providers.map((p) => ({ name: p.name, model: p.model })),
    });
    if (req.method !== 'POST') return json(405, { error: 'GET or POST only' });
    // The agent can answer a narrow set of permission-checked read-only
    // questions even if all model providers are unavailable.
    const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const out = await runAgent(await req.json(), {
      supabaseUrl: Deno.env.get('SUPABASE_URL')!,
      anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
      userToken: token, providers,
    });
    return json(200, out);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    console.error('xs-ai', status, e instanceof Error ? e.message : e);
    return json(status, { error: e instanceof ApiError ? e.message : 'XS AI ran into a problem. Please try again.' });
  }
});
