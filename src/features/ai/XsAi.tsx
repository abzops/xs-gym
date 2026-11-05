import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, Keyboard, Mic, RotateCcw, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import { canListen, listen, MicrophoneAccessError, requestMicrophone, speak, SpeechListenError, stopSpeaking, voiceFor, type Lang } from './voice';
import './ai.css';

type Action = { tool: string; ok: boolean; summary: string; undo?: { rpc: string; args: Record<string, unknown> }; undone?: boolean };
type Turn = { role: 'user' | 'assistant'; content: string; actions?: Action[]; tone?: 'bad' };
type State = 'idle' | 'listening' | 'thinking' | 'speaking';
type MicDialog = 'intro' | 'denied' | 'unavailable' | 'service' | null;

// Permission can persist within the loaded app; never assume it survives
// an iOS Home Screen app restart or a fresh page load.
let micVerifiedForPage = false;

const LANG_KEY = 'xs-ai-lang';
const HINTS: Record<Lang, string[]> = {
  en: ['How much did we collect today?', 'Who has dues?', 'Rahul paid 1500 by UPI', 'Check in Anjali'],
  ml: ['ഇന്ന് എത്ര രൂപ കിട്ടി?', 'ആർക്കൊക്കെ കുടിശ്ശികയുണ്ട്?', 'രാഹുൽ 1500 UPI ആയി അടച്ചു', 'അഞ്ജലിയെ ചെക്ക് ഇൻ ചെയ്യൂ'],
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
  const [micChecking, setMicChecking] = useState(false);
  const micCheckingRef = useRef(false);
  const micAttemptRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const micActionRef = useRef<HTMLButtonElement>(null);
  const stopRef = useRef<() => void>(() => {});
  const closingRef = useRef(false);
  const requestBusy = useRef(false);
  const listeningBusy = useRef(false);
  const undoBusy = useRef(new Set<string>());
  const scroller = useRef<HTMLDivElement>(null);
  const turnsRef = useRef(turns); turnsRef.current = turns;
  const voiceOk = canListen();

  useEffect(() => { try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ } }, [lang]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [turns, live, state]);
  useEffect(() => { if (micDialog) micActionRef.current?.focus(); }, [micDialog]);
  const stopInteraction = useCallback(() => {
    closingRef.current = true;
    micAttemptRef.current++;
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

  // The recognition API is distinct from microphone access on iOS. First
  // get an explicit microphone grant, then start Web Speech recognition.
  async function beginListening() {
    if (closingRef.current || listeningBusy.current || requestBusy.current) return;
    listeningBusy.current = true;
    stopSpeaking();
    setState('listening'); setLive('');
    try {
      const l = listen(lang, (heard) => { if (!closingRef.current) setLive(heard); });
      stopRef.current = l.stop;
      const heard = await l.done;
      listeningBusy.current = false;
      stopRef.current = () => {};
      if (closingRef.current) return;
      setState('idle');
      if (heard) await ask(heard);
    } catch (e) {
      if (!closingRef.current) {
        setState('idle');
        if (e instanceof SpeechListenError) {
          // A successful getUserMedia grant proves microphone access, but
          // Safari can separately block its speech-recognition service.
          if (['denied', 'service', 'unsupported', 'audio'].includes(e.reason)) {
            setMicDialog('service');
          } else {
            toast(e.message, 'bad');
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

  async function enableMicrophone() {
    if (closingRef.current || micCheckingRef.current || requestBusy.current) return;
    micCheckingRef.current = true;
    const attempt = ++micAttemptRef.current;
    setMicChecking(true);
    try {
      // This button press triggers the native Allow permission prompt when iOS
      // offers one. Never fake or bypass an operating-system permission.
      await requestMicrophone();
      if (closingRef.current || micAttemptRef.current !== attempt) return;
      micVerifiedForPage = true;
      setMicDialog(null);
      // Immediately try listening. On iOS versions that require a second
      // user gesture for recognition, a clear in-app Retry action is shown.
      void beginListening();
    } catch (e) {
      if (!closingRef.current && micAttemptRef.current === attempt) {
        setMicDialog(e instanceof MicrophoneAccessError && e.reason === 'denied'
          ? 'denied' : 'unavailable');
      }
    } finally {
      micCheckingRef.current = false;
      if (!closingRef.current) setMicChecking(false);
    }
  }

  function useKeyboard() {
    micAttemptRef.current++;
    setMicDialog(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function talk() {
    if (closingRef.current || micDialog) return;
    if (state === 'listening') { stopRef.current(); return; }
    if (state === 'speaking') { stopSpeaking(); return; }
    if (requestBusy.current || listeningBusy.current || micCheckingRef.current) return;
    if (!micVerifiedForPage) {
      setMicDialog('intro');
      return;
    }
    await beginListening();
  }

  async function undo(turn: number, i: number) {
    const a = turns[turn]?.actions?.[i];
    const id = `${turn}:${i}`;
    if (closingRef.current || !a?.undo || a.undone || undoBusy.current.has(id)) return;
    undoBusy.current.add(id);
    try {
      await rpc(a.undo.rpc, a.undo.args);
      if (!closingRef.current) setTurns((ts) => ts.map((t, ti) => ti !== turn ? t : { ...t, actions: t.actions?.map((x, xi) => xi === i ? { ...x, undone: true } : x) }));
      await Promise.all(['dashboard', 'payments', 'members', 'member', 'expenses', 'checkins'].map((k) => qc.invalidateQueries({ queryKey: [k, gym.id] })));
      if (!closingRef.current) toast('Undone');
    } catch (e) {
      if (!closingRef.current) toast(errorMessage(e), 'bad');
    } finally {
      undoBusy.current.delete(id);
    }
  }

  const status = state === 'listening' ? (lang === 'ml' ? 'കേൾക്കുന്നു…' : 'Listening…')
    : state === 'thinking' ? (lang === 'ml' ? 'ആലോചിക്കുന്നു…' : 'Thinking…')
    : state === 'speaking' ? (lang === 'ml' ? 'സംസാരിക്കുന്നു…' : 'Speaking…') : voiceOk ? (lang === 'ml' ? 'സംസാരിക്കാൻ ടാപ്പ് ചെയ്യൂ' : 'Tap to talk') : 'Type below';

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
            <button type="button" className={`xsai-orb ${state}`} onClick={talk} disabled={state === 'thinking'}
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
              <h3 id="xsai-mic-heading">
                {micDialog === 'intro' ? 'Enable microphone'
                  : micDialog === 'denied' ? 'Microphone permission needed'
                  : micDialog === 'service' ? 'Speech recognition unavailable'
                  : 'Microphone unavailable'}
              </h3>
              <p id="xsai-mic-desc">
                {micDialog === 'intro'
                  ? 'Allow XS AI to hear your gym commands. Your phone may ask for microphone permission.'
                  : micDialog === 'denied'
                    ? 'Your phone did not allow microphone access. Try again to request permission. If access was permanently denied, iOS may not show the Allow pop-up again.'
                    : micDialog === 'service'
                      ? 'The microphone is ready, but speech recognition could not start in this installed app. Try voice again, or dictate using your phone’s keyboard.'
                      : 'This device could not open a microphone. You can still type or use your keyboard’s dictation feature.'}
              </p>
              <div className="xsai-mic-actions">
                {micDialog !== 'unavailable' && (
                  <button ref={micActionRef} type="button" className="btn primary" disabled={micChecking}
                    onClick={() => {
                      if (micDialog === 'service') {
                        setMicDialog(null);
                        void beginListening();
                      } else {
                        void enableMicrophone();
                      }
                    }}>
                    {micChecking ? 'Requesting…'
                      : micDialog === 'service' ? 'Try voice again'
                      : micDialog === 'intro' ? 'Allow microphone' : 'Try again'}
                  </button>
                )}
                <button ref={micDialog === 'unavailable' ? micActionRef : undefined} type="button" className="btn ghost" onClick={useKeyboard}>
                  <Keyboard size={17} /> Use keyboard instead
                </button>
              </div>
              <button type="button" className="xsai-mic-dismiss"
                aria-label="Dismiss microphone help" onClick={() => { micAttemptRef.current++; setMicDialog(null); }}><X size={19}/></button>
            </section>
          </div>
        )}
      </div>
    </Sheet>
  );
}
