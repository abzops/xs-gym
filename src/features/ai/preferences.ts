/** Device-only XS AI preference. Never writes customer data or gym settings. */
export const SPOKEN_REPLIES_KEY = 'xs-ai-spoken-replies';

export function spokenRepliesEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(SPOKEN_REPLIES_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSpokenReplies(enabled: boolean): void {
  try {
    window.localStorage.setItem(SPOKEN_REPLIES_KEY, enabled ? 'on' : 'off');
  } catch {
    // Storage may be blocked in a private browser; off remains the default.
  }
}
