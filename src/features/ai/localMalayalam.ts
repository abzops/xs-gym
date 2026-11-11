// Experimental, explicitly opt-in Malayalam recognition. Audio never leaves
// this tab: Web Audio captures PCM, a browser Worker transcribes it locally.
// The model/library may download from public CDNs once, with user consent.
type ModelMessage =
  | { type: 'ready' }
  | { type: 'download'; percent: number }
  | { type: 'status'; value: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id?: number; message: string };

export type OfflinePhase = 'recording' | 'processing';
export type OfflineListen = { done: Promise<string>; stop: () => void; cancel: () => void };

let worker: Worker | null = null;
let isReady = false;
let loading: Promise<void> | null = null;
let loadResolve: (() => void) | null = null;
let loadReject: ((reason: Error) => void) | null = null;
let loadProgress = (_percent: number) => {};
let jobId = 0;
const jobs = new Map<number, { resolve: (text: string) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();

function failJobs(message: string) {
  for (const job of jobs.values()) { clearTimeout(job.timeout); job.reject(new Error(message)); }
  jobs.clear();
  loadReject?.(new Error(message));
  loadResolve = null;
  loadReject = null;
  loading = null;
  isReady = false;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./malayalam.worker.ts', import.meta.url), { type: 'module', name: 'xs-ml-offline' });
  w.onmessage = ({ data }: MessageEvent<ModelMessage>) => {
    if (data.type === 'download') loadProgress(data.percent);
    if (data.type === 'ready') {
      isReady = true;
      loadResolve?.();
      loadResolve = null;
      loadReject = null;
    }
    if (data.type === 'error' && typeof data.id !== 'number') {
      failJobs(data.message);
    }
    if ((data.type === 'result' || data.type === 'error') && typeof data.id === 'number') {
      const job = jobs.get(data.id);
      if (!job) return; // stale session or dismissed sheet
      jobs.delete(data.id);
      clearTimeout(job.timeout);
      if (data.type === 'result') job.resolve(data.text);
      else job.reject(new Error(data.message));
    }
  };
  w.onerror = () => failJobs('The local speech model stopped unexpectedly. Close and retry the app.');
  worker = w;
  return w;
}

export function localMalayalamReady() { return isReady; }

export function prepareLocalMalayalam(progress: (percentage: number) => void): Promise<void> {
  loadProgress = progress;
  if (isReady) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    loadResolve = resolve;
    loadReject = reject;
    try { ensureWorker().postMessage({ type: 'load' }); }
    catch { reject(new Error('Offline Malayalam is not available in this browser.')); }
  }).catch((error: unknown) => {
    // A failed model setup must be retriable in the same session.
    worker?.terminate();
    worker = null;
    isReady = false;
    loading = null;
    throw error;
  });
  return loading;
}

function resampleTo16k(chunks: Float32Array[], originalRate: number): Float32Array {
  const n = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!n) return new Float32Array();
  const pcm = new Float32Array(n);
  let offset = 0;
  for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
  if (originalRate === 16000) return pcm;
  const length = Math.floor(n * 16000 / originalRate);
  const out = new Float32Array(length);
  const step = originalRate / 16000;
  for (let i = 0; i < length; i++) {
    const index = i * step;
    const left = Math.floor(index);
    const right = Math.min(n - 1, left + 1);
    out[i] = pcm[left] * (1 - (index - left)) + pcm[right] * (index - left);
  }
  return out;
}

/**
 * Call directly from a real tap. Microphone permission begins synchronously
 * before any await; iOS will not grant voice permission from a background task.
 * One short phrase (maximum 12 s) is decoded entirely inside the browser.
 */
export function listenLocalMalayalam(onPhase: (phase: OfflinePhase) => void): OfflineListen {
  if (!isReady) throw new Error('Download the offline Malayalam model before starting.');
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is unavailable in this app.');
  }

  // The AudioContext is initialized within the gesture for iOS WebKit.
  const context = new AudioContext();
  void context.resume();
  const permission = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  let stopped = false;
  let cancelled = false;
  let finishCapture: (() => void) | null = null;
  let cancelPending: (() => void) | null = null;
  const stop = () => { stopped = true; finishCapture?.(); };
  const cancel = () => {
    cancelled = true;
    stop();
    cancelPending?.();
  };

  const done = (async () => {
    let stream: MediaStream | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let silent: GainNode | null = null;
    try {
      stream = await permission;
      if (stopped || cancelled) return '';
      source = context.createMediaStreamSource(stream);
      processor = context.createScriptProcessor(4096, 1, 1);
      silent = context.createGain();
      silent.gain.value = 0; // necessary for callback scheduling; no feedback
      const chunks: Float32Array[] = [];
      let total = 0;
      const maxSamples = Math.floor(context.sampleRate * 12);
      onPhase('recording');
      await new Promise<void>((resolve) => {
        finishCapture = resolve;
        processor!.onaudioprocess = (event) => {
          if (stopped || cancelled) return;
          const samples = event.inputBuffer.getChannelData(0);
          const count = Math.min(samples.length, maxSamples - total);
          if (count > 0) {
            chunks.push(samples.slice(0, count));
            total += count;
          }
          if (total >= maxSamples) stop();
        };
        source!.connect(processor!);
        processor!.connect(silent!);
        silent!.connect(context.destination);
        if (stopped) resolve();
      });
      if (cancelled) return '';
      // End capture and release microphone BEFORE doing heavy inference.
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
      const audio = resampleTo16k(chunks, context.sampleRate);
      if (audio.length < 3200) return '';
      onPhase('processing');
      return await new Promise<string>((resolve, reject) => {
        const id = ++jobId;
        const timeout = setTimeout(() => {
          jobs.delete(id);
          reject(new Error('Local transcription took too long on this device. Try a shorter phrase.'));
        }, 120_000);
        jobs.set(id, { resolve, reject, timeout });
        cancelPending = () => {
          jobs.delete(id);
          clearTimeout(timeout);
          resolve('');
        };
        ensureWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
      });
    } catch (error) {
      if (cancelled) return '';
      throw error;
    } finally {
      finishCapture = null;
      cancelPending = null;
      if (processor) { processor.onaudioprocess = null; processor.disconnect(); }
      source?.disconnect();
      silent?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      await context.close().catch(() => {});
    }
  })();
  return { done, stop, cancel };
}
