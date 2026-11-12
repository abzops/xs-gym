import type { Lang } from './voice';

export type VoiceRoute = 'browser' | 'recording' | 'realtime' | 'unavailable';
export type VoiceCapabilities = {
  native: boolean;
  recorder: boolean;
  ios: boolean;
};

/** WebKit can mute getUserMedia when Web Speech also owns the microphone.
 * Never run MediaRecorder and SpeechRecognition concurrently on iOS.
 * On other browsers native recognition gets first chance; recording stays
 * local and is uploaded only when it fails. */
export function chooseVoiceRoute(lang: Lang, cap: VoiceCapabilities): VoiceRoute {
  if (lang === 'ml' && cap.recorder && (cap.ios || !cap.native)) return 'recording';
  if (cap.native) return 'browser';
  if (lang === 'ml') return 'realtime';
  return 'unavailable';
}

export function iosVoiceDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform || '';
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
