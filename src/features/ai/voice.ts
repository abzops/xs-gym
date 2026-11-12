// Browser SpeechRecognition API only: no recorder, no STT model, no uploads
// to XS Gym. Support for an individual language is provided by the browser/OS,
// not by XS Gym. English support does not imply Malayalam support.

export type Lang = 'en' | 'ml';
const LOCALE: Record<Lang, string> = { en: 'en-IN', ml: 'ml-IN' };

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
};
type RecognitionCtor = new () => Recognition;

// Read the constructor on each tap, not at module import time. iOS installed
// PWAs and in-browser tabs may expose recognition at different times.
function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const browser = window as unknown as {
    SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

export const speechLocale = (lang: Lang, shortMalayalam = false): string =>
  lang === 'ml' && shortMalayalam ? 'ml' : LOCALE[lang];

export type MicIssue = 'denied' | 'missing' | 'busy' | 'unsupported' | 'unknown';

/** Differentiate OS microphone permission from Web Speech recognition failures. */
export class MicrophoneAccessError extends Error {
  readonly reason: MicIssue;
  constructor(reason: MicIssue, message: string) {
    super(message);
    this.name = 'MicrophoneAccessError';
    this.reason = reason;
  }
}

export class SpeechListenError extends Error {
  readonly reason: 'denied' | 'service' | 'network' | 'audio' | 'unsupported' | 'unknown';
  // Machine-readable browser result, not a guessed "microphone" explanation.
  readonly browserCode: string;
  readonly locale: string;
  constructor(reason: SpeechListenError['reason'], message: string, browserCode = 'unknown', locale = '') {
    super(message);
    this.name = 'SpeechListenError';
    this.reason = reason;
    this.browserCode = browserCode;
    this.locale = locale;
  }
}

/** A user-initiated call asks iOS / the browser to display its native Allow prompt. */
export async function requestMicrophone(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneAccessError('unsupported', 'Microphone access is not available in this app.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // This is only a permission check. Recognition starts separately, and
    // all tracks must be closed immediately (also after the sheet closes).
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)) {
      throw new MicrophoneAccessError('denied', 'Microphone permission was not granted.');
    }
    if (['NotFoundError', 'DevicesNotFoundError'].includes(name)) {
      throw new MicrophoneAccessError('missing', 'No microphone was found on this device.');
    }
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) {
      throw new MicrophoneAccessError('busy', 'The microphone is busy. Close other recordings and try again.');
    }
    throw new MicrophoneAccessError('unknown', 'Could not start the microphone. Please try again.');
  }
}

export const canListen = () => !!recognitionCtor();
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Listens once; calls onText with live text, resolves with the final text ('' if nothing heard). */
export function listen(lang: Lang, onText: (text: string) => void, shortMalayalam = false): { done: Promise<string>; stop: () => void; abort: () => void } {
  const Ctor = recognitionCtor();
  const locale = speechLocale(lang, shortMalayalam);
  if (!Ctor) return { done: Promise.reject(new SpeechListenError('unsupported',
    'This browser does not expose speech recognition.', 'api-unavailable', locale)), stop: () => {}, abort: () => {} };
  const r = new Ctor();
  r.lang = locale; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let text = '';
  const done = new Promise<string>((resolve, reject) => {
    r.onresult = (e) => {
      text = Array.from(e.results).map((res) => res[0]?.transcript ?? '').join(' ').replace(/\s+/g, ' ').trim();
      onText(text);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed') {
        reject(new SpeechListenError('denied', 'The browser denied speech recognition.', e.error, locale));
      } else if (e.error === 'service-not-allowed') {
        reject(new SpeechListenError('service', 'The browser speech service rejected this request.', e.error, locale));
      } else if (e.error === 'language-not-supported') {
        reject(new SpeechListenError('unsupported', 'The browser speech service does not support this locale.', e.error, locale));
      } else if (e.error === 'audio-capture') {
        reject(new SpeechListenError('audio', 'The browser could not open its microphone.', e.error, locale));
      } else if (e.error === 'network') {
        reject(new SpeechListenError('network', 'The browser speech service reported a network error.', e.error, locale));
      } else {
        reject(new SpeechListenError('unknown', `Speech recognition failed (${e.error}).`, e.error, locale));
      }
    };
    r.onend = () => resolve(text);
    try { r.start(); } catch (error) {
      const code = error instanceof Error ? error.name : 'start-exception';
      reject(new SpeechListenError('unknown', 'The browser could not start speech recognition.', code, locale));
    }
  });
  // stop() requests the final recognized text, while abort() deliberately
  // discards input on a canceled touch or a closed sheet. The UI alone
  // decides when to send. Browser support for Malayalam is not guaranteed.
  return {
    done,
    stop: () => { try { r.stop(); } catch { /* already ended */ } },
    abort: () => { try { r.abort(); } catch { /* already ended */ } },
  };
}

let voices: SpeechSynthesisVoice[] = [];
if (canSpeak()) {
  const load = () => { voices = window.speechSynthesis.getVoices(); };
  load();
  window.speechSynthesis.addEventListener?.('voiceschanged', load);
}

/** Best voice for the language, or null when the device has none (e.g. Malayalam on some phones). */
export function voiceFor(lang: Lang): SpeechSynthesisVoice | null {
  if (!canSpeak()) return null;
  if (!voices.length) voices = window.speechSynthesis.getVoices();
  const want = LOCALE[lang].toLowerCase();
  const list = voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang));
  return list.find((v) => v.lang.toLowerCase().replace('_', '-') === want && /google|natural|premium|enhanced/i.test(v.name))
    ?? list.find((v) => v.lang.toLowerCase().replace('_', '-') === want)
    ?? (lang === 'en' ? list[0] ?? null : null);
}

// Some browsers never fire onend after speechSynthesis.cancel(). Always settle
// the pending promise, so XS AI cannot remain stuck in its speaking state.
let finishSpeech: (() => void) | null = null;

/** Speaks text; resolves after completion, cancellation, or a stalled voice. */
export function speak(text: string, lang: Lang): Promise<boolean> {
  const voice = voiceFor(lang);
  if (!voice) return Promise.resolve(false);
  stopSpeaking();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''));
    u.voice = voice; u.lang = voice.lang; u.rate = lang === 'ml' ? 0.95 : 1.02; u.pitch = 1;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(watchdog);
      if (finishSpeech === finish) finishSpeech = null;
      resolve(true);
    };
    const watchdog = window.setTimeout(() => {
      window.speechSynthesis.cancel();
      finish();
    }, Math.min(90_000, Math.max(12_000, text.length * 150)));
    finishSpeech = finish;
    u.onend = finish; u.onerror = finish;
    try { window.speechSynthesis.speak(u); } catch { finish(); }
  });
}

export const stopSpeaking = () => {
  if (canSpeak()) window.speechSynthesis.cancel();
  finishSpeech?.();
};
