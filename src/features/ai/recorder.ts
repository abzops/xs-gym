// Records the microphone with the Web Audio API and returns 16 kHz mono WAV.
// Works in iPhone home-screen apps (getUserMedia is allowed there, unlike the
// browser's speech recognition) and the same on every browser, so the
// transcription service always gets one simple format.

export type RecorderOptions = {
  onLevel?: (level: number) => void;   // 0..1, for the orb animation
  onSpeech?: () => void;               // first time speech is detected
  // Partial WAV snapshots while speaking, for progressive cloud transcription
  // when a PWA cannot use the browser's live SpeechRecognition engine.
  onPartial?: (audioBase64: string) => void;
  previewEveryMs?: number;             // default ~2.3s; bounded to avoid rate-limit abuse
  silenceMs?: number;                  // stop after this much silence following speech
  maxMs?: number;                      // hard limit
  noSpeechMs?: number;                 // give up if nobody speaks
};
export type Recording = { stop: () => void; cancel: () => void; done: Promise<string | null> };

export class RecorderError extends Error {
  readonly reason: 'denied' | 'missing' | 'busy' | 'unsupported';
  constructor(reason: RecorderError['reason'], message: string) { super(message); this.name = 'RecorderError'; this.reason = reason; }
}

type Ctx = typeof AudioContext;
const AudioCtx = (typeof window !== 'undefined'
  ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctx }).webkitAudioContext)
  : undefined) as Ctx | undefined;

export const canRecord = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!AudioCtx;

/** True in an installed iPhone/iPad home-screen app, where Web Speech recognition is blocked. */
export const isIosStandalone = () => typeof window !== 'undefined'
  && /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document
  && ((navigator as unknown as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches);

/**
 * Must be called from a tap: the AudioContext is created synchronously inside
 * the gesture (iOS requirement), then the microphone is opened, which shows
 * the system's Allow prompt inside the app the first time.
 */
export async function startRecording(o: RecorderOptions = {}): Promise<Recording> {
  if (!canRecord()) throw new RecorderError('unsupported', 'Recording is not available in this browser.');
  const ctx = new AudioCtx!();
  void ctx.resume();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    void ctx.close();
    const n = e instanceof Error ? e.name : '';
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError' || n === 'SecurityError') throw new RecorderError('denied', 'Microphone permission was not granted.');
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') throw new RecorderError('missing', 'No microphone was found on this device.');
    throw new RecorderError('busy', 'The microphone is busy. Close other recordings and try again.');
  }
  await ctx.resume();

  const silenceMs = o.silenceMs ?? 1300, maxMs = o.maxMs ?? 30_000, noSpeechMs = o.noSpeechMs ?? 7_000;
  const rate = ctx.sampleRate;
  const src = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but universally available (AudioWorklet
  // would need a module file and a CSP exception for no real gain here).
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  const start = performance.now();
  let floor = 0.01, heard = false, lastVoice = 0, finished = false;
  let lastPreviewAt = Number.NEGATIVE_INFINITY, previewCount = 0;
  // A snapshot is an incremental preview, NOT a second microphone stream.
  // Avoid charging many Whisper calls for long speech (Groq bills >=10s/call).
  const previewEveryMs = Math.max(1_500, Math.min(5_000, o.previewEveryMs ?? 2_300));
  const previewMaxCalls = 5;
  let resolveDone!: (v: string | null) => void;
  const done = new Promise<string | null>((r) => { resolveDone = r; });

  const end = (keep: boolean) => {
    if (finished) return;
    finished = true;
    proc.onaudioprocess = null;
    try { src.disconnect(); proc.disconnect(); } catch { /* already */ }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    o.onLevel?.(0);
    resolveDone(keep && heard ? toWavBase64(chunks, rate) : null);
  };

  proc.onaudioprocess = (ev) => {
    if (finished) return;
    const input = ev.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    const rms = Math.sqrt(sum / input.length);
    const now = performance.now() - start;
    if (now < 350) floor = Math.max(floor, rms);          // room noise while the user starts
    else if (!heard) floor = floor * 0.95 + rms * 0.05;
    const threshold = Math.max(0.012, floor * 2.6);
    o.onLevel?.(Math.min(1, rms / (threshold * 3)));
    if (rms > threshold) {
      if (!heard) { heard = true; o.onSpeech?.(); }
      lastVoice = now;
    }
    // Trigger after actual speech has started, never for silence or before
    // 1.7s of audio. Full-so-far snapshots avoid word-stitching errors.
    if (o.onPartial && heard && previewCount < previewMaxCalls &&
        now >= 1_700 && now - lastPreviewAt >= previewEveryMs &&
        now - lastVoice < 650) {
      lastPreviewAt = now;
      previewCount++;
      try { o.onPartial(toWavBase64(chunks, rate)); }
      catch { /* preview is best effort; final recording still succeeds */ }
    }
    if ((heard && now - lastVoice > silenceMs) || now > maxMs) end(true);
    else if (!heard && now > noSpeechMs) end(false);
  };
  src.connect(proc);
  proc.connect(ctx.destination); // needed for onaudioprocess to fire in Safari/Chrome; output is silence
  return { stop: () => end(true), cancel: () => end(false), done };
}

/** Downmix chunks to 16 kHz 16-bit PCM WAV, trimmed of leading/trailing silence, base64. */
export function toWavBase64(chunks: Float32Array[], inRate: number): string {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const outRate = 16_000;
  const ratio = inRate / outRate;
  const n = Math.floor(total / ratio);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    // Average the source samples that fall into this output sample (simple low-pass).
    const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += all[k];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const str = (p: number, t: string) => { for (let i = 0; i < t.length; i++) view.setUint8(p + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, outRate, true); view.setUint32(28, outRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, pcm[i], true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
