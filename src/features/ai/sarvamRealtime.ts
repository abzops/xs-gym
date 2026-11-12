// Opt-in Sarvam speech experiment. Vendor API key stays only in the Edge Function.
import { supabase } from '../../lib/supabase';
import { SpeechListenError, type Lang } from './voice';

export function pcm16Base64(input: Float32Array, sampleRate: number): string {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw Error('Bad sample rate');
  const count = Math.max(1, Math.floor(input.length * 16000 / sampleRate));
  const data = new Uint8Array(count * 2);
  const view = new DataView(data.buffer);
  for (let i = 0; i < count; i++) {
    const value = Math.max(-1, Math.min(1, input[Math.min(input.length - 1, Math.floor(i * sampleRate / 16000))] ?? 0));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary);
}

type VoiceSession = { done: Promise<string>; stop: () => void; abort: () => void };
export function listenSarvam(gymId: string, lang: Lang, onText: (partial: string) => void): VoiceSession {
  const locale = lang === 'ml' ? 'ml-IN' : 'en-IN';
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let gain: GainNode | null = null;
  let ws: WebSocket | null = null;
  let ready = false, released = false, cancelled = false, settled = false;
  let finalText = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending: string[] = [];
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const done = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  const stopMedia = () => {
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = null; }
    source?.disconnect(); source = null;
    gain?.disconnect(); gain = null;
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    if (ctx) { void ctx.close().catch(() => {}); ctx = null; }
  };
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    stopMedia();
    try { ws?.close(); } catch { /* closed */ }
    ws = null; pending.length = 0;
  };
  const fail = (code: string) => {
    if (settled || cancelled) return;
    settled = true; cleanup();
    reject(new SpeechListenError('service', 'Sarvam voice unavailable. Please use typing or browser speech.', code, locale));
  };
  const finish = (text: string) => {
    if (settled || cancelled) return;
    settled = true; cleanup(); resolve(text.trim());
  };
  const send = (item: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(item)); };
  const flush = () => {
    if (!ready || cancelled) return;
    send({ event: 'speech_start' });
    for (const audio of pending) send({ event: 'audio_input', audio });
    pending.length = 0;
    if (released) send({ event: 'speech_end' });
  };
  // Trigger iOS permission inside the physical pointer-down gesture.
  let microphone: Promise<MediaStream>;
  try {
    if (typeof AudioContext === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw Error('Mic unsupported');
    microphone = navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, channelCount: 1,
    } });
  } catch {
    fail('mic-unavailable');
    return { done, stop: () => {}, abort: () => {} };
  }
  void (async () => {
    try {
      stream = await microphone;
      if (cancelled || released) { stopMedia(); return; }
      ctx = new AudioContext();
      void ctx.resume();
      source = ctx.createMediaStreamSource(stream);
      // Deprecated ScriptProcessor is isolated to POC; replace with AudioWorklet
      // and test real iOS sample rate before production.
      processor = ctx.createScriptProcessor(2048, 1, 1);
      gain = ctx.createGain(); gain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (released || cancelled || settled || !ctx) return;
        const audio = pcm16Base64(event.inputBuffer.getChannelData(0), ctx.sampleRate);
        if (ready) send({ event: 'audio_input', audio });
        else if (pending.length < 100) pending.push(audio);
        else fail('connection-slow');
      };
      source.connect(processor); processor.connect(gain); gain.connect(ctx.destination);
      const { data: { session }, error } = await supabase.auth.getSession();
      if (cancelled) { cleanup(); return; }
      if (error || !session?.access_token) { fail('not-signed-in'); return; }
      const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const url = new URL(baseUrl.replace(/^http/, 'ws') + '/functions/v1/xs-ai-sarvam');
      url.searchParams.set('gym_id', gymId); url.searchParams.set('lang', locale);
      // User JWT travels in a WebSocket subprotocol, never in a URL or JS logs.
      ws = new WebSocket(url.toString(), ['xsai-sarvam-v1', 'jwt.' + session.access_token]);
      ws.onmessage = (event) => {
        let msg: { event?: string; text?: string };
        try { msg = JSON.parse(String(event.data)); } catch { return; }
        if (msg.event === 'ready') { ready = true; flush(); }
        else if (msg.event === 'transcript.partial' && !released && !cancelled)
          onText(typeof msg.text === 'string' ? msg.text : '');
        else if (msg.event === 'transcript.final') {
          finalText = typeof msg.text === 'string' ? msg.text : '';
          if (released) finish(finalText);
          else onText(finalText);
        } else if (msg.event === 'error' || msg.event === 'closed') fail('provider-error');
      };
      ws.onerror = () => fail('socket-error');
      ws.onclose = () => { if (!settled && !cancelled) fail('disconnected'); };
    } catch { fail('connection-or-mic-error'); }
  })();
  return {
    done,
    stop: () => {
      if (released || cancelled || settled) return;
      released = true;
      stopMedia(); // release iOS microphone immediately, without awaiting Sarvam
      if (ready) send({ event: 'speech_end' });
      if (finalText) finish(finalText);
      else timer = setTimeout(() => fail('final-timeout'), 5500);
    },
    abort: () => {
      if (cancelled || settled) return;
      cancelled = true; cleanup(); resolve('');
    },
  };
}
