// Voice capture is on-device/browser by default. Cloud STT requires an
// explicit opt-in in Settings and is never selected by server flags alone.
export const INPUT_MODE_KEY = 'xs-ai-voice-input-mode';
export type SttMode = 'browser' | 'sarvam';
export function parseSttMode(value: string | null | undefined): SttMode {
  return value === 'sarvam' ? 'sarvam' : 'browser';
}
export function sttInputMode(): SttMode {
  try { return typeof window !== 'undefined' ? parseSttMode(window.localStorage.getItem(INPUT_MODE_KEY)) : 'browser'; }
  catch { return 'browser'; }
}
export function setSttInputMode(value: SttMode): void {
  try { window.localStorage.setItem(INPUT_MODE_KEY, parseSttMode(value)); } catch { /* blocked by browser */ }
}
