import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, Keyboard, Mic, RotateCcw, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import { canRecord, isIosStandalone, RecorderError, startRecording } from './recorder';
import { canListen, listen, speak, SpeechListenError, stopSpeaking, voiceFor, type Lang } from './voice';
import './ai.css';

type Action = { tool: string; ok: boolean; summary: string; undo?: { rpc: string; args: Record<string, unknown> }; undone?: boolean };
type Turn = { role: 'user' | 'assistant'; content: string; actions?: Action[]; tone?: 'bad' };
type State = 'idle' | 'listening' | 'thinking' | 'speaking';
type MicDialog = 'intro' | 'denied' | 'unavailable' | 'service' | 'setup' | 'cloud' | 'access' | null;

// Whether the server can turn recordings into text (a speech key is set).
// Asked once per app load; until known, recording is tried first.
// Kept as a plain value so a tap can decide synchronously (iOS only lets the
// microphone start inside the tap itself).
let sttKnown: Record<Lang, boolean> | null = null;
// A rejected server-side API key cannot be fixed by repeatedly opening the
// microphone. Retain the reason for this app session, per language.
const sttBlocked: Partial<Record<Lang, 'access' | 'setup'>> = {};
let sttChecking: Promise<void> | null = null;
const checkStt = () => (sttChecking ??= supabase.functions.invoke('xs-ai', { method: 'GET' })
  .then(({ data }) => {
    const support = data?.stt_languages;
    if (typeof support?.en === 'boolean' && typeof support?.ml === 'boolean')
      sttKnown = { en: sttBlocked.en ? false : support.en, ml: sttBlocked.ml ? false : support.ml };
    else if (typeof data?.stt === 'boolean')
      sttKnown = { en: sttBlocked.en ? false : data.stt, ml: sttBlocked.ml ? false : data.stt };
  }).catch(() => { sttChecking = null; }));

const LANG_KEY = 'xs-ai-lang';
const HINTS: Record<Lang, string[]> = {
  en: ['How much did we collect today?', 'Who has dues?', 'Rahul paid 1500 by UPI', 'Renew Anjali on Monthly'],
  ml: ['ഇന്ന് എത്ര രൂപ കിട്ടി?', 'ആർക്കൊക്കെ കുടിശ്ശികയുണ്ട്?', 'രാഹുൽ 1500 UPI ആയി അടച്ചു', 'അഞ്ജലിയുടെ Monthly പുതുക്കൂ'],
};

type MicCopy = { title: string; detail: string; button: string };
const MIC_COPY: Record<Lang, Record<Exclude<MicDialog, null>, MicCopy>> = {
  en: {
    intro: { title: 'Enable microphone', detail: 'Allow XS AI to hear your gym commands. Your phone may ask for microphone permission.', button: 'Allow microphone' },
    denied: { title: 'Microphone permission needed', detail: 'Your phone did not allow microphone access. Try again to request permission. If access was permanently denied, iOS may not show the Allow pop-up again.', button: 'Try again' },
    service: { title: 'Live recognition unavailable', detail: 'Your browser could not start live speech recognition. You can try recorded voice through the cloud, or use your keyboard microphone.', button: 'Try recorded voice' },
    unavailable: { title: 'Microphone unavailable', detail: 'This device could not open a microphone. You can still type or use your keyboard’s dictation feature.', button: '' },
    setup: { title: 'Voice needs a transcription service', detail: 'Your gym needs a working cloud speech provider. Supported keys are GROQ_API_KEY, GEMINI_API_KEY and XAI_API_KEY (or Grok). You can still type or use keyboard dictation.', button: '' },
    cloud: { title: 'Voice transcription unavailable', detail: 'Your microphone is working, but the speech provider could not process this recording. You can retry later or use keyboard dictation.', button: 'Try again' },
    access: { title: 'Voice provider access denied', detail: 'Your microphone works. The configured cloud speech API rejected the request (403). A gym owner must enable API access or connect a Groq Whisper/Gemini key. Repeating the recording will not resolve a blocked key.', button: '' },
  },
  ml: {
    intro: { title: 'മൈക്രോഫോൺ അനുവദിക്കുക', detail: 'ജിം കാര്യങ്ങൾ സംസാരിച്ച് ചോദിക്കാൻ XS AI-ക്ക് മൈക്രോഫോൺ അനുമതി നൽകൂ. ഫോണിൽ Allow എന്ന പോപ്പപ്പ് വന്നേക്കാം.', button: 'മൈക്രോഫോൺ അനുവദിക്കുക' },
    denied: { title: 'മൈക്രോഫോൺ അനുമതി ആവശ്യമാണ്', detail: 'ഫോൺ മൈക്രോഫോൺ അനുവദിച്ചില്ല. വീണ്ടും ശ്രമിക്കൂ. സ്ഥിരമായി ബ്ലോക്ക് ചെയ്തിട്ടുണ്ടെങ്കിൽ Allow പോപ്പപ്പ് വീണ്ടും വരണമെന്നില്ല.', button: 'വീണ്ടും ശ്രമിക്കുക' },
    service: { title: 'ലൈവ് വോയ്സ് ലഭ്യമല്ല', detail: 'ഈ ബ്രൗസറിൽ തത്സമയ ശബ്ദം തിരിച്ചറിയൽ തുടങ്ങാനായില്ല. ക്ലൗഡ് വഴി റെക്കോർഡ് ചെയ്ത് ശ്രമിക്കാം, അല്ലെങ്കിൽ കീബോർഡിലെ മൈക്ക് ഉപയോഗിക്കാം.', button: 'റെക്കോർഡ് ചെയ്ത് ശ്രമിക്കുക' },
    unavailable: { title: 'മൈക്രോഫോൺ ലഭ്യമല്ല', detail: 'ഈ ഫോണിൽ മൈക്രോഫോൺ തുറക്കാനായില്ല. പകരം ടൈപ്പ് ചെയ്യാം, അല്ലെങ്കിൽ കീബോർഡിലെ ഡിക്റ്റേഷൻ ഉപയോഗിക്കാം.', button: '' },
    setup: { title: 'വോയ്സ് സർവീസ് ആവശ്യമാണ്', detail: 'ജിം ഉടമ Supabase-ൽ പ്രവർത്തിക്കുന്ന സ്പീച്ച് API കീ ചേർക്കണം: GROQ_API_KEY, GEMINI_API_KEY, അല്ലെങ്കിൽ XAI_API_KEY (Grok). അതുവരെ ടൈപ്പ് ചെയ്യാം.', button: '' },
    cloud: { title: 'ശബ്ദം തിരിച്ചറിയാൻ കഴിഞ്ഞില്ല', detail: 'മൈക്രോഫോൺ പ്രവർത്തിക്കുന്നുണ്ട്. പക്ഷേ സ്പീച്ച് സർവീസ് ഇപ്പോൾ ലഭ്യമല്ല. പിന്നീട് വീണ്ടും ശ്രമിക്കാം, അല്ലെങ്കിൽ കീബോർഡിൽ സംസാരിച്ച് നൽകാം.', button: 'വീണ്ടും ശ്രമിക്കുക' },
    access: { title: 'മലയാളം വോയ്സ് API അനുവദിച്ചിട്ടില്ല', detail: 'നിങ്ങളുടെ മൈക്രോഫോൺ പ്രവർത്തിക്കുന്നു. പക്ഷേ സ്പീച്ച് API 403 നൽകി. ജിം അഡ്മിൻ API അനുമതി ശരിയാക്കുകയോ Groq Whisper/Gemini കീ ചേർക്കുകയോ വേണം. വീണ്ടും വീണ്ടും റെക്കോർഡ് ചെയ്താലും ഇത് മാറില്ല.', button: '' },
  },
};

/** XS AI: talk to the gym. Opens as a sheet; every action shows a card with Undo. */
export function XsAiPanel({ onClose }: { onClose: () => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>(() => { try { return localStorage.getItem(LANG_KEY) === 'ml' ? 'ml' : 'en'; } catch { return 'en'; } });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [state, setState] = useState<State>('idle');
  const [live, setLive] = useState('');
  const [text, setText] = useState('');
  const [mute, setMute] = useState(false);
  const [micDialog, setMicDialog] = useState<MicDialog>(null);
  const micChecking = false;
  const micCheckingRef = useRef(false);
  const micAttemptRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const micActionRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const closingRef = useRef(false);
  const requestBusy = useRef(false);
  const listeningBusy = useRef(false);
  const recordingEpoch = useRef(0); // Ignore late partial replies after stop/close.
  const [voiceMode, setVoiceMode] = useState<'native' | 'progressive' | null>(null);
  // Some installed browsers expose SpeechRecognition but reject its service.
  // Only fall back to WAV recording for the language that actually failed.
  const liveUnavailable = useRef(new Set<Lang>());
  const undoBusy = useRef(new Set<string>());
  const scroller = useRef<HTMLDivElement>(null);
  const turnsRef = useRef(turns); turnsRef.current = turns;
  const voiceOk = canRecord() || canListen();
  useEffect(() => { void checkStt(); }, []);

  useEffect(() => { try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ } }, [lang]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [turns, live, state]);
  useEffect(() => { if (micDialog) micActionRef.current?.focus(); }, [micDialog]);
  const stopInteraction = useCallback(() => {
    closingRef.current = true;
    micAttemptRef.current++;
    recordingEpoch.current++;
    stopRef.current();
    stopSpeaking();
  }, []);
  useEffect(() => () => { stopInteraction(); }, [stopInteraction]);

  // One request at a time: rapid taps must not record the same payment twice.
  async function ask(content: string) {
    const q = content.trim();
    if (!q || requestBusy.current || listeningBusy.current || closingRef.current) return;
    requestBusy.current = true;
    stopSpeaking();
    const history = [...turnsRef.current, { role: 'user' as const, content: q }];
    setTurns(history); setLive(''); setText(''); setState('thinking');
    try {
      const { data, error } = await supabase.functions.invoke('xs-ai', {
        body: { gym_id: gym.id, lang, messages: history.filter((t) => !t.tone).map(({ role, content: c }) => ({ role, content: c })) },
      });
      if (error) {
        let msg = errorMessage(error);
        try { const body = await (error as { context?: Response }).context?.json(); if (body?.error) msg = body.error; } catch { /* not JSON */ }
        throw new Error(msg);
      }
      const reply = String(data?.reply ?? '');
      // A write may already have succeeded when dismissed. Refresh the app,
      // but never speak or navigate from a closed conversation.
      for (const key of data?.changed ?? []) void qc.invalidateQueries({ queryKey: [key, gym.id] });
      if (closingRef.current) return;
      setTurns((t) => [...t, { role: 'assistant', content: reply, actions: data?.actions }]);
      if (typeof data?.navigate === 'string') navigate(`/g/${gym.slug}${data.navigate ? `/${data.navigate}` : ''}`);
      if (!mute && reply) {
        setState('speaking');
        await speak(reply, lang);
      }
    } catch (e) {
      if (!closingRef.current) setTurns((t) => [...t, { role: 'assistant', content: e instanceof Error ? e.message : String(e), tone: 'bad' }]);
    } finally {
      requestBusy.current = false;
      if (!closingRef.current) setState('idle');
    }
  }

  const orbRef = useRef<HTMLButtonElement>(null);
  const setLevel = (v: number) => orbRef.current?.style.setProperty('--lvl', v.toFixed(3));

  // Main voice path: record here (works in iPhone home-screen apps), then the
  // server turns the recording into text. One tap: the first time, the phone
  // shows its own Allow prompt inside the app.
  async function beginRecording() {
    if (closingRef.current || listeningBusy.current || requestBusy.current) return;
    listeningBusy.current = true;
    const epoch = ++recordingEpoch.current;
    let previewPending = false;
    let previewUnavailable = false;
    let finalDelivered = false;
    stopSpeaking();
    setVoiceMode('progressive');
    setText(''); setState('listening'); setLive('');
    // File-based Whisper cannot emit individual token deltas, but a snapshot
    // while the microphone is still recording produces progressive draft text.
    // One request at a time, capped by the recorder; an unavailable preview
    // never blocks final transcription and provider failover.
    const previewAudio = (audio: string) => {
      if (closingRef.current || recordingEpoch.current !== epoch ||
          previewPending || previewUnavailable || finalDelivered) return;
      previewPending = true;
      void (async () => {
        try {
          const { data, error } = await supabase.functions.invoke('xs-ai', {
            body: { gym_id: gym.id, transcribe: { audio, lang, preview: true } },
          });
          if (error) { previewUnavailable = true; return; }
          const partial = String(data?.text ?? '').trim();
          if (partial && !finalDelivered && !closingRef.current && recordingEpoch.current === epoch) {
            setLive(partial);
            setText(partial);
          }
        } catch { previewUnavailable = true; }
        finally { previewPending = false; }
      })();
    };
    try {
      const rec = await startRecording({ onLevel: setLevel, onPartial: previewAudio });
      if (closingRef.current || recordingEpoch.current !== epoch) { rec.cancel(); return; }
      stopRef.current = rec.stop;
      const audio = await rec.done;
      stopRef.current = () => {};
      if (closingRef.current) return;
      if (!audio) { setState('idle'); toast(lang === 'ml' ? 'ഒന്നും കേട്ടില്ല. വീണ്ടും ശ്രമിക്കൂ.' : "Didn't hear anything. Tap and speak again."); return; }
      setLive(lang === 'ml' ? 'മനസ്സിലാക്കുന്നു…' : 'Understanding…');
      setState('thinking');
      const { data, error } = await supabase.functions.invoke('xs-ai', { body: { gym_id: gym.id, transcribe: { audio, lang } } });
      if (error) {
        let msg = errorMessage(error); let status = 0; let code = '';
        try {
          const ctx = (error as { context?: Response }).context;
          status = ctx?.status ?? 0;
          const body = await ctx?.json();
          if (typeof body?.error === 'string') msg = body.error;
          if (typeof body?.code === 'string') code = body.code;
        } catch { /* not JSON */ }
        if (code === 'speech_access_denied' || code === 'speech_not_configured'
          || (status === 503 && /speech API key|speech provider/i.test(msg))) {
          const reason = code === 'speech_access_denied' ? 'access' : 'setup';
          sttBlocked[lang] = reason;
          sttKnown = {
            en: lang === 'en' ? false : (sttKnown?.en ?? true),
            ml: lang === 'ml' ? false : (sttKnown?.ml ?? true),
          };
          setLive(''); setState('idle'); setMicDialog(reason);
          return;
        }
        if (status === 503 || status === 429 || status === 502) {
          setLive(''); setState('idle'); setMicDialog('cloud'); return;
        }
        throw new Error(msg);
      }
      const heard = String(data?.text ?? '').trim();
      finalDelivered = true;
      listeningBusy.current = false;
      if (closingRef.current || recordingEpoch.current !== epoch) return;
      setLive(''); setState('idle');
      if (heard) await ask(heard);
      else toast(lang === 'ml' ? 'ഒന്നും കേട്ടില്ല. വീണ്ടും ശ്രമിക്കൂ.' : "Didn't catch that. Tap and speak again.");
    } catch (e) {
      if (closingRef.current) return;
      setState('idle'); setLive('');
      if (e instanceof RecorderError) setMicDialog(e.reason === 'denied' ? 'denied' : 'unavailable');
      else toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      finalDelivered = true;
      listeningBusy.current = false;
      stopRef.current = () => {};
      setLevel(0);
    }
  }

  // Primary voice path, restored from the original XS AI implementation.
  // Browser interim results arrive while the user is still speaking; display
  // them in the message composer immediately. A silence-triggered onend
  // submits exactly once, without waiting for a whole WAV upload.
  async function beginListening() {
    if (closingRef.current || listeningBusy.current || requestBusy.current) return;
    listeningBusy.current = true;
    stopSpeaking();
    setVoiceMode('native');
    setText(''); setLive(''); setState('listening');
    try {
      // listen() calls SpeechRecognition.start() synchronously before its
      // first await, preserving the iOS user gesture from the mic button.
      const l = listen(lang, (partial) => {
        if (!closingRef.current) setText(partial);
      });
      stopRef.current = l.stop;
      const heard = (await l.done).trim();
      listeningBusy.current = false;
      stopRef.current = () => {};
      if (closingRef.current) return;
      setState('idle');
      if (heard) {
        setText('');
        await ask(heard); // automatic send when speech recognition ends
      } else {
        setText('');
        toast(lang === 'ml' ? 'ഒന്നും കേട്ടില്ല. വീണ്ടും ശ്രമിക്കൂ.' : "Didn't hear anything. Tap to speak again.");
      }
    } catch (e) {
      if (!closingRef.current) {
        setState('idle');
        // Keep any partial transcript in the input so it can be sent by hand.
        if (e instanceof SpeechListenError) {
          // Web Speech isn't usable for this language in this session; a
          // subsequent tap offers the recorded-audio fallback where possible.
          liveUnavailable.current.add(lang);
          if (e.reason === 'denied' || e.reason === 'audio') {
            setMicDialog('denied');
          } else if (sttBlocked[lang]) {
            setMicDialog('access');
          } else if (canRecord() && sttKnown?.[lang] !== false) {
            setMicDialog('service');
          } else {
            setMicDialog('setup');
          }
        } else {
          toast(e instanceof Error ? e.message : String(e), 'bad');
        }
      }
    } finally {
      listeningBusy.current = false;
      stopRef.current = () => {};
    }
  }

  function useKeyboard() {
    micAttemptRef.current++;
    setMicDialog(null);
    // iOS only opens the virtual keyboard from a synchronous user gesture.
    // Focusing in requestAnimationFrame after the tap can silently fail.
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    });
  }

  // One tap starts LIVE Web Speech, including in installed iOS web apps when
  // the recognition engine is actually available. WAV/cloud is a fallback,
  // never the default: waiting for a full recording destroyed live feedback.
  async function talk(retry = false) {
    if (closingRef.current || (micDialog && !retry)) return;
    if (state === 'listening') { stopRef.current(); return; }
    if (state === 'speaking') { stopSpeaking(); return; }
    if (requestBusy.current || listeningBusy.current || micCheckingRef.current) return;
    if (canListen() && !liveUnavailable.current.has(lang)) return beginListening();
    // A provider with rejected credentials must not receive another recording.
    if (sttBlocked[lang]) { setMicDialog('access'); return; }
    if (canRecord() && sttKnown?.[lang] !== false) return beginRecording();
    setMicDialog(canRecord() ? 'setup' : 'unavailable');
  }

  async function undo(turn: number, i: number) {
    const a = turns[turn]?.actions?.[i];
    const id = `${turn}:${i}`;
    if (closingRef.current || !a?.undo || a.undone || undoBusy.current.has(id)) return;
    undoBusy.current.add(id);
    try {
      await rpc(a.undo.rpc, a.undo.args);
      if (!closingRef.current) setTurns((ts) => ts.map((t, ti) => ti !== turn ? t : { ...t, actions: t.actions?.map((x, xi) => xi === i ? { ...x, undone: true } : x) }));
      await Promise.all(['dashboard', 'payments', 'members', 'member', 'expenses', 'analytics', 'enquiries', 'daily-report'].map((k) => qc.invalidateQueries({ queryKey: [k, gym.id] })));
      if (!closingRef.current) toast('Undone');
    } catch (e) {
      if (!closingRef.current) toast(errorMessage(e), 'bad');
    } finally {
      undoBusy.current.delete(id);
    }
  }

  const status = state === 'listening'
    ? voiceMode === 'progressive'
      ? (lang === 'ml' ? 'കേൾക്കുന്നു · തത്സമയ ടെക്സ്റ്റ്…' : 'Listening · progressive text…')
      : (lang === 'ml' ? 'ലൈവ് കേൾക്കുന്നു…' : 'Listening live…')
    : state === 'thinking' ? (lang === 'ml' ? 'ആലോചിക്കുന്നു…' : 'Thinking…')
    : state === 'speaking' ? (lang === 'ml' ? 'സംസാരിക്കുന്നു…' : 'Speaking…')
      : sttBlocked[lang] && isIosStandalone() && !canListen() ? (lang === 'ml' ? 'കീബോർഡിലെ മൈക്ക് ഉപയോഗിക്കൂ' : 'Use keyboard dictation')
      : voiceOk ? (lang === 'ml' ? 'സംസാരിക്കാൻ ടാപ്പ് ചെയ്യൂ' : 'Tap to talk') : 'Type below';

  return (
    <Sheet title="XS AI" onClosing={stopInteraction} onClose={() => { stopInteraction(); onClose(); }}>
      <div className="xsai">
        <div className="xsai-bar">
          <Segmented label="Language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'ml', label: 'മലയാളം' }]} />
          <button type="button" className={`btn small ghost ${mute ? '' : 'on'}`} onClick={() => { setMute((m) => !m); stopSpeaking(); }} aria-pressed={!mute}>
            {mute ? 'Voice off' : 'Voice on'}
          </button>
        </div>

        <div className="xsai-log" ref={scroller} aria-live="polite">
          {turns.length === 0 && (
            <div className="xsai-empty">
              <p>{lang === 'ml' ? 'ജിമ്മിനെക്കുറിച്ച് എന്തും ചോദിക്കൂ, അല്ലെങ്കിൽ ചെയ്യാൻ പറയൂ.' : 'Ask anything about your gym, or tell me what to do.'}</p>
              <div className="xsai-hints">
                {HINTS[lang].map((h) => <button type="button" key={h} className="btn small" onClick={() => ask(h)}>{h}</button>)}
              </div>
            </div>
          )}
          {turns.map((t, ti) => (
            <div key={ti} className={`xsai-turn ${t.role} ${t.tone ?? ''}`}>
              {t.actions?.map((a, i) => (
                <div key={i} className={`xsai-action ${a.ok ? (a.undone ? 'undone' : 'ok') : 'bad'}`}>
                  <span className="xsai-action-ico" aria-hidden>{a.ok ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}</span>
                  <span className="xsai-action-text">{a.undone ? <s>{a.summary}</s> : a.summary}</span>
                  {a.ok && a.undo && !a.undone && <button type="button" className="btn small ghost" onClick={() => undo(ti, i)}><RotateCcw size={14} /> Undo</button>}
                </div>
              ))}
              {t.content && <p className="xsai-bubble" lang={t.role === 'assistant' ? (lang === 'ml' ? 'ml' : 'en') : undefined}>{t.content}</p>}
            </div>
          ))}
          {state === 'listening' && live && <div className="xsai-turn user live"><p className="xsai-bubble">{live}</p></div>}
          {state === 'thinking' && <div className="xsai-turn assistant"><p className="xsai-bubble xsai-dots" aria-label="Thinking"><i /><i /><i /></p></div>}
        </div>

        <div className="xsai-controls">
          {voiceOk && (
            <button ref={orbRef} type="button" className={`xsai-orb ${state}`} onClick={() => void talk()} disabled={state === 'thinking'}
              aria-label={state === 'listening' ? 'Stop listening' : state === 'speaking' ? 'Stop speaking' : 'Talk to XS AI'}>
              <span className="xsai-orb-glow" aria-hidden />
              {state === 'listening' || state === 'speaking' ? <Square size={22} fill="currentColor" /> : <Mic size={26} />}
            </button>
          )}
          <p className="xsai-status" aria-live="polite">{status}{lang === 'ml' && !mute && !voiceFor('ml') ? ' · replies shown as text on this device' : ''}</p>
          <form className="xsai-type" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={lang === 'ml' ? 'ടൈപ്പ് ചെയ്യൂ…' : 'Type a message…'} aria-label="Message XS AI" enterKeyHint="send" />
            <button className="btn primary icon-btn" disabled={!text.trim() || state !== 'idle'} aria-label="Send"><ArrowUp size={20} /></button>
          </form>
        </div>

        {micDialog && (
          <div className="xsai-mic-backdrop">
            <section className="xsai-mic-dialog" role="dialog" aria-modal="true" aria-labelledby="xsai-mic-heading" aria-describedby="xsai-mic-desc">
              <span className="xsai-mic-icon" aria-hidden><Mic size={27} strokeWidth={1.8} /></span>
              <h3 id="xsai-mic-heading">{MIC_COPY[lang][micDialog].title}</h3>
              <p id="xsai-mic-desc">{MIC_COPY[lang][micDialog].detail}</p>
              <div className="xsai-mic-actions">
                {micDialog !== 'unavailable' && micDialog !== 'setup' && micDialog !== 'access' && (
                  <button ref={micActionRef} type="button" className="btn primary" disabled={micChecking}
                    onClick={() => { setMicDialog(null); void talk(true); }}>
                    {micChecking ? (lang === 'ml' ? 'അനുമതി ചോദിക്കുന്നു…' : 'Requesting…')
                      : MIC_COPY[lang][micDialog].button}
                  </button>
                )}
                <button ref={micDialog === 'unavailable' || micDialog === 'setup' || micDialog === 'access' ? micActionRef : undefined}
                  type="button" className={`btn ${micDialog === 'access' ? 'primary' : 'ghost'}`} onClick={useKeyboard}>
                  <Keyboard size={17} /> {lang === 'ml' ? 'കീബോർഡ് ഉപയോഗിക്കുക' : 'Use keyboard instead'}
                </button>
                {micDialog === 'access' && (
                  <p className="xsai-dictation-hint">
                    {lang === 'ml'
                      ? 'ടൈപ്പ് ചെയ്യാനുള്ള ബോക്സ് തുറന്നാൽ iPhone കീബോർഡിലെ മൈക്ക് അമർത്തി മലയാളത്തിൽ സംസാരിക്കാം.'
                      : 'After the keyboard opens, tap its microphone to dictate your message.'}
                  </p>
                )}
              </div>
              <button type="button" className="xsai-mic-dismiss"
                aria-label={lang === 'ml' ? 'മൈക്രോഫോൺ സഹായം അടയ്ക്കുക' : 'Dismiss microphone help'} onClick={() => { micAttemptRef.current++; setMicDialog(null); }}><X size={19}/></button>
            </section>
          </div>
        )}
      </div>
    </Sheet>
  );
}
