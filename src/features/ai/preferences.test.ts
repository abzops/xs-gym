import { afterEach, describe, expect, it, vi } from 'vitest';
import { setSpokenReplies, spokenRepliesEnabled, SPOKEN_REPLIES_KEY } from './preferences';

afterEach(() => vi.unstubAllGlobals());

describe('XS AI spoken replies preference (device-local, opt-in)', () => {
  it('is disabled when no browser storage exists', () => {
    vi.stubGlobal('window', undefined);
    expect(spokenRepliesEnabled()).toBe(false);
  });
  it('defaults off and persists only an explicit on choice', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, value); },
      },
    });
    expect(spokenRepliesEnabled()).toBe(false);
    setSpokenReplies(true);
    expect(data.get(SPOKEN_REPLIES_KEY)).toBe('on');
    expect(spokenRepliesEnabled()).toBe(true);
    setSpokenReplies(false);
    expect(data.get(SPOKEN_REPLIES_KEY)).toBe('off');
    expect(spokenRepliesEnabled()).toBe(false);
  });
  it('fails silently and stays off if localStorage is blocked', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('storage blocked'); },
        setItem: () => { throw new Error('storage blocked'); },
      },
    });
    expect(spokenRepliesEnabled()).toBe(false);
    expect(() => setSpokenReplies(true)).not.toThrow();
    expect(spokenRepliesEnabled()).toBe(false);
  });
});
