/** Microphone capture for XS AI. Records one short voice command with the
 * browser's own encoder (WebM/Opus on Android and Chrome, MP4/AAC on iPhone),
 * watches the level to stop automatically after the user stops talking, and
 * returns the clip as base64 for Sarvam speech-to-text on the server.
 * Nothing is recorded outside an explicit tap, and tracks are released at once. */

export type Clip = { data: string; mime: string; ms: number };
export type Recording = {
  /** Stop and return the clip; null when nothing was said. */
  stop: () => Promise<Clip | null>;
  cancel: () => void;
};
export type RecorderError = 'denied' | 'unsupported' | 'busy';
export class MicError extends Error {
  reason: RecorderError;
  constructor(reason: RecorderError, message: string) { super(message); this.reason = reason; }
}

const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/aac'];
export const MAX_MS = 28_000;
const SILENCE_MS = 1_300; // after speech, this much quiet ends the command
const NO_SPEECH_MS = 7_000; // nothing said at all

export function canRecord(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function pickType(): string {
  for (const t of TYPES) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch { /* old Safari */ }
  }
  return '';
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Must be called from a tap so iOS allows the microphone and audio context. */
export async function startRecording(opts: { onAutoStop: () => void; onLevel?: (level: number) => void }): Promise<Recording> {
  if (!canRecord()) throw new MicError('unsupported', 'Voice recording is not supported in this browser.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (e) {
    const name = (e as DOMException)?.name;
    throw new MicError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotReadableError' ? 'busy' : 'unsupported',
      'Microphone is not available.');
  }
  const type = pickType();
  let recorder: MediaRecorder;
  try { recorder = type ? new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 48_000 }) : new MediaRecorder(stream); }
  catch { stream.getTracks().forEach((t) => t.stop()); throw new MicError('unsupported', 'Voice recording is not supported in this browser.'); }

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start(250);
  const started = performance.now();

  // Level meter + end-of-speech detection.
  let ctx: AudioContext | null = null; let raf = 0; let spoke = false;
  let lastLoud = started; let floor = 0.008; let finished = false;
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (Ctor) {
    try {
      ctx = new Ctor();
      void ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (finished) return;
        analyser.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms < floor * 1.5) floor = floor * 0.95 + rms * 0.05; // track background noise
        const loud = rms > Math.max(0.018, floor * 3);
        if (loud) { lastLoud = now; if (now - started > 150) spoke = true; }
        opts.onLevel?.(Math.min(1, rms / 0.12));
        const elapsed = now - started;
        if ((spoke && now - lastLoud > SILENCE_MS) || (!spoke && elapsed > NO_SPEECH_MS) || elapsed > MAX_MS) {
          finished = true; opts.onAutoStop(); return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch { ctx = null; spoke = true; }
  } else spoke = true; // no meter: trust the user's tap to stop

  const release = () => {
    finished = true;
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close().catch(() => {});
  };
  let stopping: Promise<Clip | null> | null = null;
  return {
    stop: () => {
      if (stopping) return stopping;
      stopping = new Promise<Clip | null>((resolve) => {
        const done = async () => {
          release();
          const ms = Math.round(performance.now() - started);
          const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' });
          if (!spoke || ms < 500 || blob.size < 1200) return resolve(null);
          try { resolve({ data: await toBase64(blob), mime: blob.type, ms }); } catch { resolve(null); }
        };
        if (recorder.state === 'inactive') { void done(); return; }
        recorder.onstop = () => { void done(); };
        try { recorder.requestData(); } catch { /* not supported everywhere */ }
        recorder.stop();
      });
      return stopping;
    },
    cancel: () => {
      recorder.onstop = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already stopped */ }
      release();
    },
  };
}
