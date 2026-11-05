// Speech-to-text for XS AI. The app records audio itself (works in iPhone
// home-screen apps, where the browser's own speech recognition is blocked),
// converts it to 16 kHz mono WAV and sends it here.
// Providers, first that is configured and answers wins:
//   GROQ_API_KEY            → Whisper (fast, free tier)
//   GEMINI_API_KEY / LLM_API_KEY (Google key) → Gemini audio understanding
import { ApiError } from './agent.ts';

export type SttEnv = { groqKey?: string; geminiKey?: string; geminiModel?: string; fetch?: typeof fetch };
export const sttConfigured = (e: SttEnv) => !!(e.groqKey || e.geminiKey);

const MAX_B64 = 4_000_000; // ≈ 2 minutes of 16 kHz mono 16-bit WAV
const HINT = 'XS Gym. Members, plans, payments, UPI, cash, card, dues, renewal, expense, rupees, XS-0001.';

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
  for (const model of ['whisper-large-v3-turbo', 'whisper-large-v3']) {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', model);
    form.append('language', lang);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    form.append('prompt', HINT);
    const r = await withTimeout(15_000, (signal) => f('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal,
    }));
    if (r.status === 404 || r.status === 400) continue; // model retired: try the other
    if (!r.ok) throw new Error(`groq ${r.status}`);
    return String(((await r.json()) as { text?: string }).text ?? '').trim();
  }
  throw new Error('groq: no whisper model available');
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
    if (!r.ok) throw new Error(`gemini ${r.status}`);
    const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  }
  throw new Error('gemini: no model available');
}

/** Returns the transcript ('' when nothing was said). */
export async function transcribe(body: { audio?: unknown; lang?: unknown }, env: SttEnv): Promise<string> {
  const f = env.fetch ?? fetch;
  if (!sttConfigured(env)) throw new ApiError('Voice needs a speech key. The gym owner can add GROQ_API_KEY in Supabase. You can type instead.', 503);
  const b64 = typeof body.audio === 'string' ? body.audio : '';
  if (!b64 || b64.length > MAX_B64 || !/^[A-Za-z0-9+/]+=*$/.test(b64)) throw new ApiError('That recording could not be read. Please try again.', 400);
  const lang = body.lang === 'ml' ? 'ml' : 'en';
  const failures: string[] = [];
  if (env.groqKey) {
    try { return await groq(decode(b64), lang, env.groqKey, f); } catch (e) { failures.push(String(e instanceof Error ? e.message : e)); }
  }
  if (env.geminiKey) {
    try { return await gemini(b64, lang, env.geminiKey, env.geminiModel, f); } catch (e) { failures.push(String(e instanceof Error ? e.message : e)); }
  }
  console.error('XS AI transcription failed:', failures.join(' → '));
  throw new ApiError('Could not understand the recording right now. Please try again, or type.', 503);
}
