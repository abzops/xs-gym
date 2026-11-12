import { describe, expect, it } from 'vitest';
import { parseSttMode, sttInputMode } from './sttPreferences';

describe('XS AI opt-in cloud microphone mode', () => {
  it('defaults to the browser for missing or unknown saved values', () => {
    expect(parseSttMode(null)).toBe('browser');
    expect(parseSttMode('')).toBe('browser');
    expect(parseSttMode('cloud')).toBe('browser');
  });
  it('requires an explicit Sarvam value', () => {
    expect(parseSttMode('sarvam')).toBe('sarvam');
  });
  it('stays on browser mode without window storage', () => {
    expect(sttInputMode()).toBe('browser');
  });
});
