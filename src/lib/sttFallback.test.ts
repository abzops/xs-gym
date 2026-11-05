import { describe, expect, it, vi } from 'vitest';
import { sttConfigured, transcribe } from '../../supabase/functions/xs-ai/stt';

const wav = btoa('RIFF----WAVEfmt ----data----');
const request = { audio: wav, lang: 'en' };

describe('XS Gym recorded-voice speech-to-text', () => {
  it('recognizes the existing xAI Grok key as a configured provider', () => {
    expect(sttConfigured({ xaiKey: 'test' })).toBe(true);
    expect(sttConfigured({ groqKey: 'test' })).toBe(true);
    expect(sttConfigured({ geminiKey: 'test' })).toBe(true);
    expect(sttConfigured({})).toBe(false);
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

  it('uses Whisper first when a Groq speech key is available', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ text: 'രാഹുൽ 1500 UPI ആയി അടച്ചു' }), { status: 200 }));
    const result = await transcribe({ audio: wav, lang: 'ml' },
      { groqKey: 'speech-key', xaiKey: 'backup', fetch: fetcher as typeof fetch });
    expect(result).toContain('രാഹുൽ');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('api.groq.com');
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
