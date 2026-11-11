// Experimental Malayalam speech engine. Never send microphone samples to a
// server: inference happens inside this worker. No production release is
// authorized until the library + model are self-hosted and audited.
// Version pinned for repeatable prototype testing.
const LIBRARY = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
const MODEL = 'onnx-community/whisper-tiny';
const REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7';

type Pipeline = (audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>;
let loading: Promise<Pipeline> | null = null;
let model: Pipeline | null = null;

function report(message: Record<string, unknown>) {
  self.postMessage(message);
}

async function getPipeline(): Promise<Pipeline> {
  if (model) return model;
  if (!loading) loading = (async () => {
    report({ type: 'status', value: 'loading' });
    // Official browser ESM distribution. Load only after explicit opt-in;
    // never download a speech model while English voice is being used.
    const { pipeline, env } = await import(/* @vite-ignore */ LIBRARY);
    env.useBrowserCache = true;
    env.allowRemoteModels = true; // Only code and pretrained model files.
    env.backends.onnx.wasm.numThreads = 1; // Keep iPhone memory consumption lower.
    const asr = await pipeline('automatic-speech-recognition', MODEL, {
      revision: REVISION,
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (event: { progress?: number; status?: string }) => {
        if (event.status === 'progress' && typeof event.progress === 'number') {
          report({ type: 'download', percent: Math.max(0, Math.min(100, Math.round(event.progress))) });
        }
      },
    });
    model = asr as Pipeline;
    report({ type: 'ready' });
    return model;
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

self.onmessage = async (event: MessageEvent<{ type: string; id?: number; audio?: Float32Array }>) => {
  const { type, id, audio } = event.data;
  if (type === 'load') {
    try { await getPipeline(); }
    catch {
      report({ type: 'error', id, message: 'Cannot load the offline Malayalam model. Check storage and network, then try again.' });
    }
    return;
  }
  if (type !== 'transcribe' || !audio || typeof id !== 'number') return;
  try {
    const asr = await getPipeline();
    if (audio.length < 3200) {
      report({ type: 'result', id, text: '' });
      return;
    }
    // Whisper needs 16-kHz PCM; this buffer is never sent via fetch/HTTP.
    const result = await asr(audio, {
      language: 'malayalam',
      task: 'transcribe',
      max_new_tokens: 256,
      return_timestamps: false,
    });
    report({ type: 'result', id, text: String(result?.text ?? '').trim() });
  } catch {
    report({ type: 'error', id, message: 'Offline Malayalam transcription failed. The audio was not uploaded. Try a shorter phrase.' });
  }
};
