// Browser Web Speech API for live interim transcription and spoken replies.
// XS AI does not capture or upload raw audio. Browser providers may handle
// recognition remotely; only recognized text is sent to the XS AI server.

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

const recognitionCtor = (): RecognitionCtor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

export const canListen = () => !!recognitionCtor();
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Listens once; calls onText with live text, resolves with the final text ('' if nothing heard). */
export function listen(lang: Lang, onText: (text: string) => void): { done: Promise<string>; stop: () => void } {
  const Ctor = recognitionCtor();
  if (!Ctor) return { done: Promise.reject(new SpeechListenError('unsupported', 'Live speech recognition is not available. Use keyboard dictation or type instead.')), stop: () => {} };
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
      if (e.error === 'not-allowed') {
        reject(new SpeechListenError('denied', 'Speech recognition was not allowed by this device.'));
      } else if (e.error === 'service-not-allowed') {
        reject(new SpeechListenError('service', 'Speech recognition is unavailable in this app.'));
      } else if (e.error === 'language-not-supported') {
        reject(new SpeechListenError('unsupported', 'This voice recognition service does not support the selected language.'));
      } else if (e.error === 'audio-capture') {
        reject(new SpeechListenError('audio', 'Speech recognition could not open the microphone.'));
      } else if (e.error === 'network') {
        reject(new SpeechListenError('network', 'Voice recognition needs an internet connection.'));
      } else {
        reject(new SpeechListenError('unknown', `Voice recognition could not start (${e.error}).`));
      }
    };
    r.onend = () => resolve(text);
    try { r.start(); } catch {
      reject(new SpeechListenError('denied', 'Speech recognition could not start on this device.'));
    }
  });
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
