import { describe, expect, it } from 'vitest';
import { chooseVoiceRoute } from './voiceRoute';

describe('Automatic Malayalam voice routing', () => {
  it('avoids concurrent SpeechRecognition and getUserMedia on iOS across every press', () => {
    for (let n = 0; n < 8; n++) {
      expect(chooseVoiceRoute('ml', { native: true, recorder: true, ios: true }))
        .toBe('recording');
    }
  });
  it('uses local-browser recognition first on other supported browsers', () => {
    expect(chooseVoiceRoute('ml', { native: true, recorder: true, ios: false }))
      .toBe('browser');
  });
  it('automatically uses Sarvam recording when native Malayalam is unavailable', () => {
    expect(chooseVoiceRoute('ml', { native: false, recorder: true, ios: false }))
      .toBe('recording');
  });
  it('retains a realtime fallback when MediaRecorder is not supported', () => {
    expect(chooseVoiceRoute('ml', { native: false, recorder: false, ios: true }))
      .toBe('realtime');
  });
  it('keeps English as browser-only and preserves unsupported handling', () => {
    expect(chooseVoiceRoute('en', { native: true, recorder: true, ios: true }))
      .toBe('browser');
    expect(chooseVoiceRoute('en', { native: false, recorder: true, ios: true }))
      .toBe('unavailable');
  });
});
