import { afterEach, describe, expect, it, vi } from 'vitest';
import { MicrophoneAccessError, canListen, listen, requestMicrophone, speechLocale } from './voice';

afterEach(() => vi.unstubAllGlobals());

describe('XS AI microphone permission', () => {
  it('requests the native microphone and immediately releases its tracks', async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }] }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await requestMicrophone();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('turns an OS denial into an in-app recoverable state', async () => {
    const getUserMedia = vi.fn(async () => {
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      throw error;
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await expect(requestMicrophone()).rejects.toMatchObject({
      name: 'MicrophoneAccessError', reason: 'denied',
    } satisfies Partial<MicrophoneAccessError>);
  });

  it('distinguishes missing hardware from permission denial', async () => {
    const getUserMedia = vi.fn(async () => {
      const error = new Error('No device');
      error.name = 'NotFoundError';
      throw error;
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await expect(requestMicrophone()).rejects.toMatchObject({
      name: 'MicrophoneAccessError', reason: 'missing',
    });
  });

  it('explains microphone unavailability without opening Settings', async () => {
    vi.stubGlobal('navigator', { mediaDevices: undefined });
    await expect(requestMicrophone()).rejects.toMatchObject({
      name: 'MicrophoneAccessError', reason: 'unsupported',
    });
  });
});

describe('browser-only Malayalam recognition (no STT model)', () => {
  function mockBrowser() {
    let active: FakeRecognition | null = null;
    class FakeRecognition {
      lang = ''; interimResults = false; continuous = true; maxAlternatives = 0;
      onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() { active = this; }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    vi.stubGlobal('window', { webkitSpeechRecognition: FakeRecognition });
    return () => active;
  }

  it('rechecks the Web Speech constructor when the browser adds it later', () => {
    vi.stubGlobal('window', {});
    expect(canListen()).toBe(false);
    const active = mockBrowser();
    expect(canListen()).toBe(true);
    const result = listen('ml', vi.fn());
    expect(active()?.lang).toBe('ml-IN');
    active()?.onend?.();
    return expect(result.done).resolves.toBe('');
  });

  it('offers a second browser-only Malayalam tag without affecting English', async () => {
    const active = mockBrowser();
    expect(speechLocale('en', true)).toBe('en-IN');
    expect(speechLocale('ml')).toBe('ml-IN');
    expect(speechLocale('ml', true)).toBe('ml');
    const onText = vi.fn();
    const result = listen('ml', onText, true);
    expect(active()?.lang).toBe('ml');
    expect(active()?.interimResults).toBe(true);
    active()?.onresult?.({ results: [{ 0: { transcript: 'ഇന്ന് എത്ര രൂപ' }, length: 1, isFinal: false }] });
    expect(onText).toHaveBeenLastCalledWith('ഇന്ന് എത്ര രൂപ');
    active()?.onend?.();
    await expect(result.done).resolves.toBe('ഇന്ന് എത്ര രൂപ');
  });

  it.each(['language-not-supported', 'service-not-allowed', 'network', 'no-speech'])(
    'preserves real browser error code %s instead of generic microphone error', async (code) => {
      const active = mockBrowser();
      const result = listen('ml', vi.fn());
      active()?.onerror?.({ error: code });
      active()?.onend?.();
      await expect(result.done).rejects.toMatchObject({
        name: 'SpeechListenError', locale: 'ml-IN', browserCode: code,
      });
    }
  );
});
