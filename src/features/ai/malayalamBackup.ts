// Browser-first Malayalam safety recording. We keep the sound ON DEVICE
// while native recognition runs and upload it only if native recognition fails.
// Audio is never sent to the XS AI chat model; only recognized text is.
import { supabase } from '../../lib/supabase';
import { SpeechListenError } from './voice';

export type MalayalamClip = { blob: Blob; durationMs: number };

/** Record locally from the SAME physical hold as Web Speech Recognition.
 * iOS Safari commonly supports audio/mp4; Chrome uses audio/webm.
 * No network connection is opened until transcribeFailedNative is called. */
export function captureMalayalamBackup(): {
  stop: () => Promise<MalayalamClip | null>;
  abort: () => void;
} {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let recordingAt = 0, released = false, cancelled = false, finished = false;
  const chunks: BlobPart[] = [];
  let resolveClip!: (clip: MalayalamClip | null) => void;
  const result = new Promise<MalayalamClip | null>((resolve) => { resolveClip = resolve; });
  const stopTracks = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };
  const complete = (clip: MalayalamClip | null) => {
    if (finished) return;
    finished = true; stopTracks();
    resolveClip(cancelled ? null : clip);
  };
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
      throw Error('Recording unsupported');
    // This MUST be called synchronously from the pointerdown user gesture.
    void navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, channelCount: 1,
    } }).then((media) => {
      stream = media;
      if (cancelled || released) { complete(null); return; }
      const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
      const mime = types.find((type) => MediaRecorder.isTypeSupported(type));
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => { if (!cancelled && event.data.size) chunks.push(event.data); };
      recorder.onerror = () => complete(null);
      recorder.onstop = () => {
        if (cancelled || !chunks.length) { complete(null); return; }
        const blob = new Blob(chunks, { type: recorder?.mimeType || mime || 'audio/webm' });
        complete(blob.size > 300
          ? { blob, durationMs: Math.min(30_000, Math.max(100, Date.now() - recordingAt)) }
          : null);
      };
      recordingAt = Date.now();
      recorder.start(150);
    }).catch(() => complete(null));
  } catch { complete(null); }

  return {
    stop: () => {
      if (cancelled || released) return result;
      released = true;
      if (recorder?.state === 'recording') {
        try { recorder.stop(); } catch { complete(null); }
      } // If permission hasn't resolved, the .then above closes the late stream.
      return result;
    },
    abort: () => {
      if (cancelled) return;
      cancelled = true; released = true;
      try { if (recorder?.state === 'recording') recorder.stop(); }
      catch { /* device already stopped */ }
      complete(null);
    },
  };
}

function toBase64(data: ArrayBuffer): string {
  const array = new Uint8Array(data);
  const size = 0x8000;
  let encoded = '';
  for (let i = 0; i < array.length; i += size) {
    encoded += String.fromCharCode(...array.subarray(i, i + size));
  }
  return btoa(encoded);
}

/** Cloud upload after native recognizer failure, never before. */
export async function transcribeFailedNative(gymId: string, clip: MalayalamClip | null): Promise<string> {
  if (!clip) throw new SpeechListenError('audio', 'Recording unavailable.', 'no-audio', 'ml-IN');
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token)
    throw new SpeechListenError('denied', 'Sign in to use Malayalam voice.', 'not-signed-in', 'ml-IN');
  const bytes = await clip.blob.arrayBuffer();
  if (bytes.byteLength < 300 || bytes.byteLength > 2_100_000)
    throw new SpeechListenError('audio', 'Recording was too short or large.', 'invalid-audio', 'ml-IN');
  const url = String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '') + '/functions/v1/xs-ai-sarvam';
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
        'authorization': 'Bearer ' + data.session.access_token,
      },
      body: JSON.stringify({
        gym_id: gymId, lang: 'ml-IN',
        audio: toBase64(bytes),
        mime: clip.blob.type || 'audio/webm',
        duration_ms: clip.durationMs,
      }),
      signal: AbortSignal.timeout(26000),
    });
  } catch {
    throw new SpeechListenError('network', 'Cloud speech service unreachable.', 'network-error', 'ml-IN');
  }
  if (!response.ok) throw new SpeechListenError('service',
    'Malayalam speech service unavailable.', response.status === 503 ? 'not-configured' : 'provider-error', 'ml-IN');
  const json = await response.json() as { text?: unknown };
  const transcript = typeof json.text === 'string' ? json.text.trim().slice(0, 2000) : '';
  return transcript;
}
