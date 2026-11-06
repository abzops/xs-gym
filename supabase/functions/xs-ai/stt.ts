// Speech-to-text for XS AI. The app records audio itself (works in iPhone
// home-screen apps, where the browser's own speech recognition is blocked),
// converts it to 16 kHz mono WAV and sends it here.
// Providers use server-side keys only. Groq Whisper has documented Malayalam
// support; xAI STT supports more languages but does NOT explicitly list Malayalam
// in its formatting-language table, so Gemini remains available as backup.
//   GROQ_API_KEY            → Groq Whisper
//   NVIDIA_API_KEY          → NVIDIA Riva ASR for English only
//   XAI_API_KEY / Grok      → xAI grok-voice-transcribe-2.0
//   GEMINI_API_KEY          → Gemini audio understanding
import { ApiError } from './agent.ts';

export type SttEnv = { groqKey?: string; nvidiaKey?: string; xaiKey?: string; geminiKey?: string; geminiModel?: string; fetch?: typeof fetch };
export const sttConfigured = (e: SttEnv, lang: 'en' | 'ml' = 'en') => !!(e.groqKey || e.xaiKey || e.geminiKey || (lang === 'en' && e.nvidiaKey));

export type SpeechFailureCode = 'speech_not_configured' | 'speech_access_denied' | 'speech_rate_limited' | 'speech_provider_unavailable';
export class SpeechUnavailableError extends ApiError {
  readonly code: SpeechFailureCode;
  readonly lang: 'en' | 'ml';
  readonly retryable: boolean;
  constructor(code: SpeechFailureCode, lang: 'en' | 'ml', message: string, retryable = false) {
    super(message, 503);
    this.name = 'SpeechUnavailableError';
    this.code = code;
    this.lang = lang;
    this.retryable = retryable;
  }
}
class ProviderHttpError extends Error {
  readonly status: number;
  constructor(provider: string, status: number) {
    super(`${provider} ${status}`);
    this.status = status;
  }
}

const MAX_B64 = 4_000_000; // ≈ 2 minutes of 16 kHz mono 16-bit WAV
const HINT = 'XS Gym. Members, plans, payments, UPI, cash, card, dues, renewal, expense, rupees, XS-0001.';
const MALAYALAM_HINT = 'മലയാളം. ജിം അംഗങ്ങൾ, മാസവരി, കുടിശ്ശിക, പുതുക്കൽ, പണം, രൂപ, UPI, cash. ഉദാഹരണം: ഇന്ന് എത്ര രൂപ കിട്ടി? രാഹുൽ ആയിരത്തഞ്ഞൂറ് രൂപ UPI ആയി അടച്ചു.';

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await run(ctl.signal); } finally { clearTimeout(t); }
}

async function groq(audio: Uint8Array, lang: 'en' | 'ml', key: string, f: typeof fetch): Promise<string> {
  // Larger Whisper is more reliable for Malayalam and Malayalam-English speech.
  for (const model of lang === 'ml' ? ['whisper-large-v3', 'whisper-large-v3-turbo'] : ['whisper-large-v3-turbo', 'whisper-large-v3']) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', model);
    form.append('language', lang);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    form.append('prompt', lang === 'ml' ? MALAYALAM_HINT : HINT);
    const r = await withTimeout(15_000, (signal) => f('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal,
    }));
    if (r.status === 404 || r.status === 400) continue; // model retired: try the other
    if (!r.ok) throw new ProviderHttpError('Groq Whisper', r.status);
    return String(((await r.json()) as { text?: string }).text ?? '').trim();
  }
  throw new Error('groq: no whisper model available');
}

// NVIDIA API Catalog Riva preview endpoint, Parakeet English ASR.
// This endpoint is not multilingual Malayalam; never use it in ml mode.
const NVIDIA_ASR = 'https://1598d209-5e27-4d3c-8079-4751568b1081.invocation.api.nvcf.nvidia.com/v1/audio/transcriptions';
async function nvidia(audio: Uint8Array, key: string, f: typeof fetch): Promise<string> {
  const form = new FormData();
  form.append('language', 'en-US');
  form.append('word_time_offsets', 'False');
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'speech.wav');
  const response = await withTimeout(18_000, (signal) => f(NVIDIA_ASR, {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal,
  }));
  if (!response.ok) throw new ProviderHttpError('NVIDIA English ASR', response.status);
  const json = await response.json() as {
    text?: string; transcript?: string;
    results?: { alternatives?: { transcript?: string }[] }[];
  };
  const transcript = json.text ?? json.transcript ??
    json.results?.map((r) => r.alternatives?.[0]?.transcript ?? '').join(' ') ?? '';
  return String(transcript).trim().slice(0, 2000);
}

/** xAI's official /v1/stt REST endpoint. Never sends the API key to the browser. */
async function xai(audio: Uint8Array, lang: 'en' | 'ml', key: string, f: typeof fetch): Promise<string> {
  const form = new FormData();
  form.append('model', 'grok-voice-transcribe-2.0');
  // xAI's supported *formatting* list includes English, not Malayalam.
  // Omit language entirely for Malayalam so the server can auto-detect.
  if (lang === 'en') { form.append('language', 'en'); form.append('format', 'true'); }
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'speech.wav');
  const r = await withTimeout(20_000, (signal) => f('https://api.x.ai/v1/stt', {
    method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal,
  }));
  if (!r.ok) throw new ProviderHttpError('xAI speech service', r.status);
  const result = (await r.json()) as { text?: string };
  return String(result.text ?? '').trim().slice(0, 2000);
}

async function gemini(b64: string, lang: 'en' | 'ml', key: string, model: string | undefined, f: typeof fetch): Promise<string> {
  const instruction = `Transcribe this speech exactly as spoken. The speaker is a gym owner or receptionist in Kerala speaking ${lang === 'ml' ? 'Malayalam (write it in Malayalam script; keep English words like UPI, cash and numbers as they are)' : 'English (Indian accent; numbers as digits)'}. ${HINT} Output only the transcript, nothing else. If there is no speech, output nothing.`;
  for (const m of [...new Set([model, 'gemini-flash-latest', 'gemini-2.5-flash'].filter(Boolean))] as string[]) {
    const r = await withTimeout(20_000, (signal) => f(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', signal,
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: instruction }, { inline_data: { mime_type: 'audio/wav', data: b64 } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 512 },
      }),
    }));
    if (r.status === 404) continue;
    if (!r.ok) throw new ProviderHttpError('Gemini speech service', r.status);
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  }
  throw new Error('gemini: no model available');
}

/** Returns the transcript ('' when nothing was said). Never logs audio or keys. */
export async function transcribe(body: { audio?: unknown; lang?: unknown }, env: SttEnv): Promise<string> {
  const f = env.fetch ?? fetch;
  const lang = body.lang === 'ml' ? 'ml' : 'en';
  if (!sttConfigured(env, lang)) {
    throw new SpeechUnavailableError('speech_not_configured', lang,
      lang === 'ml'
        ? 'Malayalam voice needs a speech provider. Ask the gym owner to add a Groq Whisper or Gemini key in Supabase. You can use keyboard dictation now.'
        : 'Voice needs a supported speech provider. You can use keyboard dictation now.');
  }
  const b64 = typeof body.audio === 'string' ? body.audio : '';
  if (!b64 || b64.length > MAX_B64 || !/^[A-Za-z0-9+/]+=*$/.test(b64))
    throw new ApiError('That recording could not be read. Please try again.', 400);
  const failures: { provider: string; status?: number; detail: string }[] = [];
  const recordFailure = (provider: string, error: unknown) => {
    failures.push({
      provider,
      status: error instanceof ProviderHttpError ? error.status : undefined,
      detail: error instanceof Error ? error.message : String(error),
    });
  };
  if (env.groqKey) {
    try { return await groq(decode(b64), lang, env.groqKey, f); } catch (e) { recordFailure('groq', e); }
  }
  // English-only NVIDIA ASR must never be used to guess Malayalam transcripts.
  if (lang === 'en' && env.nvidiaKey) {
    try { return await nvidia(decode(b64), env.nvidiaKey, f); } catch (e) { recordFailure('nvidia', e); }
  }
  if (env.xaiKey) {
    try { return await xai(decode(b64), lang, env.xaiKey, f); } catch (e) { recordFailure('xai', e); }
  }
  if (env.geminiKey) {
    try { return await gemini(b64, lang, env.geminiKey, env.geminiModel, f); } catch (e) { recordFailure('gemini', e); }
  }
  // Diagnostics contain only provider names and HTTP statuses, never keys,
  // audio or personal gym data.
  console.error('XS AI transcription failed:', failures.map((x) => x.detail).join(' -> '));
  const accessBlocked = failures.length > 0 && failures.every((x) => [401, 402, 403].includes(x.status ?? 0));
  if (accessBlocked) {
    throw new SpeechUnavailableError('speech_access_denied', lang,
      lang === 'ml'
        ? 'Malayalam microphone recording works, but all configured speech providers rejected API access. Add a working GROQ_API_KEY (Whisper) or GEMINI_API_KEY in Supabase, or fix xAI API permissions and credits.'
        : 'Microphone recording works, but the speech provider rejected API access. Check your API permissions and credits.');
  }
  const rateLimited = failures.length > 0 && failures.every((x) => x.status === 429);
  if (rateLimited)
    throw new SpeechUnavailableError('speech_rate_limited', lang, 'Speech provider limit reached. Try voice again later, or use keyboard dictation.', true);
  throw new SpeechUnavailableError('speech_provider_unavailable', lang,
    'The speech provider could not transcribe this recording. Try again later, or use keyboard dictation.', true);
}
