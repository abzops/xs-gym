import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, Keyboard, Mic, RotateCcw, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import { canListen, listen, speak, SpeechListenError, stopSpeaking, voiceFor, type Lang } from './voice';
import './ai.css';

type Action = { tool: string; ok: boolean; summary: string; undo?: { rpc: string; args: Record<string, unknown> }; undone?: boolean };
type Turn = { role: 'user' | 'assistant'; content: string; actions?: Action[]; tone?: 'bad' };
type State = 'idle' | 'listening' | 'thinking' | 'speaking';
type MicDialog = 'denied' | 'unavailable' | 'service' | null;

// XS AI sends typed text only. Audio recording/upload is intentionally disabled.
// Live word-by-word recognition uses the browser's SpeechRecognition interface.

const LANG_KEY = 'xs-ai-lang';
const HINTS: Record<Lang, string[]> = {
  en: ['How much did we collect today?', 'Who has dues?', 'Rahul paid 1500 by UPI', 'Renew Anjali on Monthly'],
  ml: ['ഇന്ന് എത്ര രൂപ കിട്ടി?', 'ആർക്കൊക്കെ കുടിശ്ശികയുണ്ട്?', 'രാഹുൽ 1500 UPI ആയി അടച്ചു', 'അഞ്ജലിയുടെ Monthly പുതുക്കൂ'],
};

type MicCopy = { title: string; detail: string; button: string };
const MIC_COPY: Record<Lang, Record<Exclude<MicDialog, null>, MicCopy>> = {
  en: {
    denied: { title: 'Microphone permission needed', detail: 'Your device did not allow live speech recognition. Try again if permission can be requested, or use your keyboard microphone to dictate.', button: 'Try live voice again' },
    service: { title: 'Live speech unavailable', detail: 'Live speech recognition is not available in this browser or installed app. XS AI will not record or upload audio. Use the microphone on your keyboard to dictate instead.', button: 'Try live voice again' },
    unavailable: { title: 'Use keyboard dictation', detail: 'This browser does not support live speech recognition. Tap the message field, then the microphone on your phone keyboard. Only the text you submit goes to XS AI.', button: '' },
  },
  ml: {
    denied: { title: 'മൈക്രോഫോൺ അനുമതി ആവശ്യമാണ്', detail: 'ലൈവ് വോയ്സ് തിരിച്ചറിയാൻ ഫോൺ അനുമതി നൽകിയില്ല. വീണ്ടും ശ്രമിക്കാം; അല്ലെങ്കിൽ കീബോർഡിലെ മൈക്ക് ഉപയോഗിച്ച് മലയാളത്തിൽ പറയാം.', button: 'ലൈവ് വോയ്സ് വീണ്ടും ശ്രമിക്കുക' },
    service: { title: 'ലൈവ് വോയ്സ് ലഭ്യമല്ല', detail: 'ഈ ബ്രൗസറിലോ ഇൻസ്റ്റാൾ ചെയ്ത ആപ്പിലോ തത്സമയ സ്പീച്ച് തിരിച്ചറിയൽ ലഭ്യമല്ല. XS AI ഓഡിയോ റെക്കോർഡ് ചെയ്ത് അപ്‌ലോഡ് ചെയ്യില്ല. കീബോർഡിലെ മൈക്ക് ഉപയോഗിക്കാം.', button: 'വീണ്ടും ശ്രമിക്കുക' },
    unavailable: { title: 'കീബോർഡ് ഡിക്റ്റേഷൻ ഉപയോഗിക്കുക', detail: 'ഈ ബ്രൗസറിൽ ലൈവ് സ്പീച്ച് തിരിച്ചറിയൽ ലഭ്യമല്ല. മെസേജ് ബോക്സിൽ ടാപ്പ് ചെയ്ത് iPhone കീബോർഡിലെ മൈക്ക് അമർത്തി മലയാളത്തിൽ സംസാരിക്കുക. അയക്കുന്ന ടെക്സ്റ്റ് മാത്രമേ XS AI-ലേക്ക് പോകൂ.', button: '' },
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
  const [text, setText] = useState('');
  const [mute, setMute] = useState(false);
  const [micDialog, setMicDialog] = useState<MicDialog>(null);
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
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [turns, state]);
  useEffect(() => { if (micDialog) micActionRef.current?.focus(); }, [micDialog]);
  const stopInteraction = useCallback(() => {
    closingRef.current = true;
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
    setTurns(history); setText(''); setState('thinking');
    try {
      const { data, error } = await supabase.functions.invoke('xs-ai', {
        // One UUID per user command lets the database deduplicate a repeated
        // HTTP request without deduplicating a genuinely new payment command.
        body: { gym_id: gym.id, lang, request_id: crypto.randomUUID(),
          messages: history.filter((t) => !t.tone).map(({ role, content: c }) => ({ role, content: c })) },
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

  // Primary voice path, restored from the original XS AI implementation.
  // Browser interim results arrive while the user is still speaking; display
  // them in the message composer immediately. A silence-triggered onend
  // submits exactly once, without waiting for a whole WAV upload.
  async function beginListening() {
    if (closingRef.current || listeningBusy.current || requestBusy.current) return;
    listeningBusy.current = true;
    stopSpeaking();
    setText(''); setState('listening');
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
        // Preserve any partial words in the text field for manual sending.
        if (e instanceof SpeechListenError) {
          setMicDialog(e.reason === 'denied' || e.reason === 'audio' ? 'denied' : 'service');
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
    setMicDialog(null);
    // iOS only opens the virtual keyboard from a synchronous user gesture.
    // Focusing in requestAnimationFrame after the tap can silently fail.
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    });
  }

  // SpeechRecognition is the ONLY voice input. Never record or upload raw audio.
  async function talk(retry = false) {
    if (closingRef.current || (micDialog && !retry)) return;
    if (state === 'listening') { stopRef.current(); return; }
    if (state === 'speaking') { stopSpeaking(); return; }
    if (requestBusy.current || listeningBusy.current) return;
    if (canListen()) { void beginListening(); return; }
    setMicDialog('unavailable');
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

  const status = state === 'listening' ? (lang === 'ml' ? 'കേൾക്കുന്നു…' : 'Listening…')
    : state === 'thinking' ? (lang === 'ml' ? 'ആലോചിക്കുന്നു…' : 'Thinking…')
    : state === 'speaking' ? (lang === 'ml' ? 'സംസാരിക്കുന്നു…' : 'Speaking…')
      : voiceOk ? (lang === 'ml' ? 'സംസാരിക്കാൻ ടാപ്പ് ചെയ്യൂ' : 'Tap to talk')
      : (lang === 'ml' ? 'കീബോർഡിലെ മൈക്ക് ഉപയോഗിക്കൂ' : 'Use keyboard dictation');

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
          {state === 'thinking' && <div className="xsai-turn assistant"><p className="xsai-bubble xsai-dots" aria-label="Thinking"><i /><i /><i /></p></div>}
        </div>

        <div className="xsai-controls">
          {
            <button type="button" className={`xsai-orb ${state}`} onClick={() => void talk()} disabled={state === 'thinking'}
              aria-label={state === 'listening' ? 'Stop listening' : state === 'speaking' ? 'Stop speaking' : 'Talk to XS AI'}>
              <span className="xsai-orb-glow" aria-hidden />
              {state === 'listening' || state === 'speaking' ? <Square size={22} fill="currentColor" /> : <Mic size={26} />}
            </button>
          }
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
                {micDialog !== 'unavailable' && (
                  <button ref={micActionRef} type="button" className="btn primary"
                    onClick={() => { setMicDialog(null); void talk(true); }}>
                    {MIC_COPY[lang][micDialog].button}
                  </button>
                )}
                <button ref={micDialog === 'unavailable' ? micActionRef : undefined}
                  type="button" className="btn ghost" onClick={useKeyboard}>
                  <Keyboard size={17} /> {lang === 'ml' ? 'കീബോർഡ് ഉപയോഗിക്കുക' : 'Use keyboard instead'}
                </button>
               </div>
              <button type="button" className="xsai-mic-dismiss"
                aria-label={lang === 'ml' ? 'മൈക്രോഫോൺ സഹായം അടയ്ക്കുക' : 'Dismiss microphone help'} onClick={() => setMicDialog(null)}><X size={19}/></button>
            </section>
          </div>
        )}
      </div>
    </Sheet>
  );
}
