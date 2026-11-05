// Free, on-device-or-browser speech: Web Speech API for listening and speaking.
// Chrome/Edge/Android and iOS Safari 14.5+ support recognition; Firefox does not
// (XS AI then works by typing).

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

const Ctor = (typeof window !== 'undefined'
  ? (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition
  : undefined);

export const canListen = () => !!Ctor;
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Listens once; calls onText with live text, resolves with the final text ('' if nothing heard). */
export function listen(lang: Lang, onText: (text: string) => void): { done: Promise<string>; stop: () => void } {
  if (!Ctor) return { done: Promise.reject(new Error('Voice input is not supported in this browser. Type instead.')), stop: () => {} };
  const r = new Ctor();
  r.lang = LOCALE[lang]; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
  let text = '';
  const done = new Promise<string>((resolve, reject) => {
    r.onresult = (e) => {
      text = Array.from(e.results).map((res) => res[0]?.transcript ?? '').join(' ').replace(/\s+/g, ' ').trim();
      onText(text);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      reject(new Error(e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Microphone access is blocked. Allow it in the browser settings, or type instead.'
        : e.error === 'network' ? 'Voice needs an internet connection.' : `Could not hear that (${e.error}).`));
    };
    r.onend = () => resolve(text);
  });
  r.start();
  return { done, stop: () => r.stop() };
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
