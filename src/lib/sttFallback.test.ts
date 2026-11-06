import { describe, expect, it, vi } from 'vitest';
import { sttConfigured, transcribe } from '../../supabase/functions/xs-ai/stt';

const wav = btoa('RIFF----WAVEfmt ----data----');
const request = { audio: wav, lang: 'en' };

describe('XS Gym recorded-voice speech-to-text', () => {
  it('recognizes the existing xAI Grok key as a configured provider', () => {
    expect(sttConfigured({ nvidiaKey: 'test' })).toBe(true);
    expect(sttConfigured({ nvidiaKey: 'test' }, 'ml')).toBe(false);
    expect(sttConfigured({ xaiKey: 'test' })).toBe(true);
    expect(sttConfigured({ groqKey: 'test' })).toBe(true);
    expect(sttConfigured({ geminiKey: 'test' })).toBe(true);
    expect(sttConfigured({})).toBe(false);
  });

  it('uses NVIDIA Riva only for English when the NVIDIA key is available', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: 'Rahul paid 1500 by UPI' }), { status: 200 }));
    const answer = await transcribe(request, { nvidiaKey: 'nvapi-test', xaiKey: 'backup', fetch: fetcher as typeof fetch });
    expect(answer).toBe('Rahul paid 1500 by UPI');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('invocation.api.nvcf.nvidia.com');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer nvapi-test' });
    const form = init?.body as FormData;
    expect(form.get('language')).toBe('en-US');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('switches to xAI when NVIDIA English ASR rejects the request', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) =>
      String(url).includes('nvcf.nvidia.com') ? new Response('unavailable', { status: 403 })
        : new Response(JSON.stringify({ text: 'Hello from xAI' }), { status: 200 }));
    const answer = await transcribe(request, { nvidiaKey: 'invalid', xaiKey: 'xai', fetch: fetcher as typeof fetch });
    expect(answer).toBe('Hello from xAI');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('refuses Malayalam-only NVIDIA configuration before making a network request', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(transcribe({ audio: wav, lang: 'ml' },
      { nvidiaKey: 'english-only', fetch: fetcher as typeof fetch }))
      .rejects.toThrow('Malayalam voice needs a speech provider');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('never sends Malayalam recordings to an English-only NVIDIA ASR model', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: 'മലയാളം' }), { status: 200 }));
    const answer = await transcribe({ audio: wav, lang: 'ml' },
      { nvidiaKey: 'nvidia', xaiKey: 'xai', fetch: fetcher as typeof fetch });
    expect(answer).toBe('മലയാളം');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('api.x.ai');
  });

  it('uses the official xAI STT endpoint, keeping the key off the frontend', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: 'Today collected 1500 rupees' }), { status: 200 }));
    const result = await transcribe(request, { xaiKey: 'private-test-key', fetch: fetcher as typeof fetch });
    expect(result).toBe('Today collected 1500 rupees');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/stt');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer private-test-key' });
    const fields = init?.body as FormData;
    expect(fields.get('model')).toBe('grok-voice-transcribe-2.0');
    expect(fields.get('language')).toBe('en');
    expect(fields.get('file')).toBeInstanceOf(Blob);
    expect([...fields.keys()].at(-1)).toBe('file');
  });

  it('allows automatic language detection for Malayalam without claiming format support', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: 'ഇന്ന് എത്ര രൂപ കിട്ടി?' }), { status: 200 }));
    const result = await transcribe({ audio: wav, lang: 'ml' }, { xaiKey: 'key', fetch: fetcher as typeof fetch });
    expect(result).toContain('ഇന്ന്');
    const fields = fetcher.mock.calls[0][1]?.body as FormData;
    expect(fields.get('language')).toBeNull();
    expect(fields.get('format')).toBeNull();
  });

  it('fails over from rejected xAI speech credentials to Gemini when configured', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) =>
      String(url).includes('api.x.ai') ? new Response('forbidden', { status: 403 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ഇന്ന് പണം കിട്ടി' }] } }] }), { status: 200 }));
    const result = await transcribe({ audio: wav, lang: 'ml' },
      { xaiKey: 'not-authorized', geminiKey: 'google-key', fetch: fetcher as typeof fetch });
    expect(result).toBe('ഇന്ന് പണം കിട്ടി');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('previews Malayalam with fast Groq Whisper only, then leaves final accuracy choice unchanged', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: 'രാഹുൽ' }), { status: 200 }));
    const preview = await transcribe({ audio: wav, lang: 'ml', preview: true },
      { groqKey: 'speech-key', xaiKey: 'backup', fetch: fetcher as typeof fetch });
    expect(preview).toBe('രാഹുൽ');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toContain('api.groq.com');
    expect((init?.body as FormData).get('model')).toBe('whisper-large-v3-turbo');
    expect((init?.body as FormData).get('language')).toBe('ml');
  });

  it('does not send interim speech snapshots to xAI when Groq preview is not configured', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(transcribe({ audio: wav, lang: 'ml', preview: true },
      { xaiKey: 'a-valid-chat-key', fetch: fetcher as typeof fetch }))
      .rejects.toMatchObject({ code: 'speech_not_configured', retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not fall back to xAI for repeated preview snapshots when Groq returns 403', async () => {
    const fetcher = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(transcribe({ audio: wav, lang: 'ml', preview: true },
      { groqKey: 'bad-groq', xaiKey: 'xai', fetch: fetcher as typeof fetch }))
      .rejects.toMatchObject({ code: 'speech_access_denied', retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('api.groq.com');
  });

  it('uses Whisper first when a Groq speech key is available', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: 'രാഹുൽ 1500 UPI ആയി അടച്ചു' }), { status: 200 }));
    const result = await transcribe({ audio: wav, lang: 'ml' },
      { groqKey: 'speech-key', xaiKey: 'backup', fetch: fetcher as typeof fetch });
    expect(result).toContain('രാഹുൽ');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('api.groq.com');
    const fields = fetcher.mock.calls[0][1]?.body as FormData;
    expect(fields.get('model')).toBe('whisper-large-v3');
    expect(String(fields.get('prompt'))).toContain('മലയാളം');
    expect(fields.get('language')).toBe('ml');
  });

  it('reports the real provider permission problem when Malayalam xAI returns 403', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('forbidden', { status: 403 }));
    await expect(transcribe({ audio: wav, lang: 'ml' },
      { nvidiaKey: 'nv-english-only', xaiKey: 'bad-key', fetch: fetcher as typeof fetch }))
      .rejects.toMatchObject({
        code: 'speech_access_denied',
        lang: 'ml',
        retryable: false,
        status: 503,
      });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('api.x.ai');
  });

  it('reports temporary provider outages as retryable instead of invalid microphone permissions', async () => {
    const fetcher = vi.fn(async () => new Response('upstream unavailable', { status: 502 }));
    await expect(transcribe({ audio: wav, lang: 'ml' },
      { xaiKey: 'key', fetch: fetcher as typeof fetch }))
      .rejects.toMatchObject({ code: 'speech_provider_unavailable', retryable: true });
  });

  it('classifies provider rate limits separately from revoked access', async () => {
    const fetcher = vi.fn(async () => new Response('rate limit', { status: 429 }));
    await expect(transcribe({ audio: wav, lang: 'ml' },
      { xaiKey: 'key', fetch: fetcher as typeof fetch }))
      .rejects.toMatchObject({ code: 'speech_rate_limited', retryable: true });
  });

  it('never claims speech is configured when the selected language has no supported provider', async () => {
    await expect(transcribe({ audio: wav, lang: 'ml' }, { nvidiaKey: 'english-only' }))
      .rejects.toMatchObject({ code: 'speech_not_configured', retryable: false, lang: 'ml' });
  });

  it('rejects malformed or oversized recordings before any provider call', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    await expect(transcribe({ audio: 'not base64!', lang: 'en' },
      { xaiKey: 'key', fetch: fetcher as typeof fetch })).rejects.toThrow('recording could not be read');
    await expect(transcribe({ audio: 'A'.repeat(4_000_001), lang: 'en' },
      { xaiKey: 'key', fetch: fetcher as typeof fetch })).rejects.toThrow('recording could not be read');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
