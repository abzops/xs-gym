import { afterEach, describe, expect, it, vi } from 'vitest';
import { canListen, listen, SpeechListenError } from './voice';

afterEach(() => vi.unstubAllGlobals());

function fakeRecognition() {
  const instances: FakeRecognition[] = [];
  class FakeRecognition {
    lang = '';
    interimResults = false;
    continuous = true;
    maxAlternatives = 0;
    onresult: ((e: { results: { transcript: string }[][] }) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn(() => this.onend?.());
    abort = vi.fn(() => this.onend?.());
    constructor() { instances.push(this); }
  }
  vi.stubGlobal('window', { webkitSpeechRecognition: FakeRecognition });
  return instances;
}

describe('XS AI live text-only recognition', () => {
  it('shows Malayalam text incrementally and returns final text on end', async () => {
    const instances = fakeRecognition();
    const interim: string[] = [];
    const { done } = listen('ml', (value) => interim.push(value));
    const mic = instances[0];
    expect(canListen()).toBe(true);
    expect(mic.lang).toBe('ml-IN');
    expect(mic.interimResults).toBe(true);
    expect(mic.continuous).toBe(false);
    expect(mic.start).toHaveBeenCalledOnce();
    mic.onresult?.({ results: [[{ transcript: 'ഇന്ന്' }]] });
    mic.onresult?.({ results: [[{ transcript: 'ഇന്ന് എത്ര രൂപ കിട്ടി?' }]] });
    expect(interim).toEqual(['ഇന്ന്', 'ഇന്ന് എത്ര രൂപ കിട്ടി?']);
    mic.onend?.();
    expect(await done).toBe('ഇന്ന് എത്ര രൂപ കിട്ടി?');
  });

  it('recognizes English and finalizes when the user taps stop', async () => {
    const instances = fakeRecognition();
    const onPartial = vi.fn();
    const { done, stop } = listen('en', onPartial);
    expect(instances[0].lang).toBe('en-IN');
    instances[0].onresult?.({ results: [[{ transcript: 'Who has dues?' }]] });
    stop();
    expect(instances[0].stop).toHaveBeenCalledOnce();
    expect(await done).toBe('Who has dues?');
    expect(onPartial).toHaveBeenCalledOnce();
  });

  it('never opens MediaRecorder or getUserMedia from the app', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const instances = fakeRecognition();
    const { done } = listen('ml', () => {});
    instances[0].onend?.();
    await done;
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('reports unavailable recognition instead of capturing audio', async () => {
    vi.stubGlobal('window', {});
    expect(canListen()).toBe(false);
    await expect(listen('ml', () => {}).done).rejects.toMatchObject({
      name: 'SpeechListenError', reason: 'unsupported',
    } satisfies Partial<SpeechListenError>);
  });

  it('distinguishes browser recognition permission and service failures', async () => {
    const instances = fakeRecognition();
    const denied = listen('ml', () => {});
    instances[0].onerror?.({ error: 'not-allowed' });
    await expect(denied.done).rejects.toMatchObject({ reason: 'denied' });
    const service = listen('ml', () => {});
    instances[1].onerror?.({ error: 'service-not-allowed' });
    await expect(service.done).rejects.toMatchObject({ reason: 'service' });
  });
});
