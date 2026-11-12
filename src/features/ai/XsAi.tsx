import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, Keyboard, Mic, RotateCcw, Square, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
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
type MicDialog = 'denied' | 'unavailable' | 'service' | 'unsupported' | null;

type HoldSession = {
  pointerId: number | null;
  released: boolean;
  cancelled: boolean;
  settled: boolean;
  latest: string;
  final: string;
  stop: () => void;
  abort: () => void;
  watchdog: ReturnType<typeof setTimeout> | null;
};

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
    unavailable: { title: 'Browser speech is unavailable', detail: 'This browser does not expose SpeechRecognition. You can type your message instead.', button: '' },
    unsupported: { title: 'Speech language not supported', detail: 'Your browser rejected the requested language. XS Gym cannot install recognition languages into the iPhone browser.', button: 'Try browser voice again' },
  },
  ml: {
    denied: { title: 'ബ്രൗസർ വോയ്സ് അനുമതി നിഷേധിച്ചു', detail: 'ബ്രൗസർ സ്പീച്ച് തിരിച്ചറിയൽ നിരസിച്ചു. ഇത് മലയാളം മോഡൽ ലഭ്യമാണെന്നതിന് തെളിവല്ല. വീണ്ടും ശ്രമിക്കാം, അല്ലെങ്കിൽ മലയാളത്തിൽ ടൈപ്പ് ചെയ്യാം.', button: 'വീണ്ടും ശ്രമിക്കുക' },
    service: { title: 'ലൈവ് വോയ്സ് ലഭ്യമല്ല', detail: 'iPhone ബ്രൗസറിലെ വോയ്സ് സേവനം മലയാളം തിരിച്ചറിയൽ നിരസിച്ചു. മറ്റൊരു മലയാളം ഭാഷാ കോഡ് പരീക്ഷിക്കാം. പിന്തുണയില്ലെങ്കിൽ XS Gym-ന് ബ്രൗസറിനെ നിർബന്ധിച്ച് തിരിച്ചറിയിക്കാൻ കഴിയില്ല.', button: 'വീണ്ടും ശ്രമിക്കുക' },
    unavailable: { title: 'ബ്രൗസർ വോയ്സ് ലഭ്യമല്ല', detail: 'ഈ ബ്രൗസറിൽ SpeechRecognition API ഇല്ല. മലയാളം ടൈപ്പ് ചെയ്യാം.', button: '' },
    unsupported: { title: 'മലയാളം വോയ്സ് ഈ ബ്രൗസറിൽ പിന്തുണയ്ക്കുന്നില്ല', detail: 'iPhone-ന്റെ സ്പീച്ച് സേവനം ഈ ഭാഷാ കോഡ് നിരസിച്ചു. ഒരു ബദൽ മലയാളം കോഡ് പരീക്ഷിക്കാം; അത് പ്രവർത്തിക്കുമെന്ന് ഉറപ്പില്ല.', button: 'വീണ്ടും ശ്രമിക്കുക' },
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
  const [speechIssue, setSpeechIssue] = useState<{ code: string; locale: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const micActionRef = useRef<HTMLButtonElement>(null);
  const holdRef = useRef<HoldSession | null>(null);
  const activePointer = useRef<number | null>(null);
  const keyboardHeld = useRef(false);
  const suppressClickUntil = useRef(0);
  const [alternateMalayalam, setAlternateMalayalam] = useState(false);
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
    activePointer.current = null;
    keyboardHeld.current = false;
    const session = holdRef.current;
    holdRef.current = null;
    listeningBusy.current = false;
    if (session) {
      session.cancelled = true;
      if (session.watchdog) clearTimeout(session.watchdog);
      session.abort();
    }
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

  // iPhone and Android use pointerdown/up, not click-to-toggle. SpeechRecognition
  // starts synchronously inside the finger-down gesture. No separate STT model
  // or microphone recorder is used; this is the browser's native API.
  function finishTranscript(session: HoldSession) {
    if (holdRef.current !== session || session.cancelled || !session.released) return;
    if (session.watchdog) clearTimeout(session.watchdog);
    holdRef.current = null;
    listeningBusy.current = false;
    if (closingRef.current) return;
    const heard = (session.final || session.latest).trim();
    if (heard) {
      setText('');
      void ask(heard); // Only release can send; silence/end while held cannot.
    } else {
      setText('');
      setState('idle');
      toast(lang === 'ml' ? 'വാക്കുകൾ ലഭിച്ചില്ല. വീണ്ടും അമർത്തിപ്പിടിച്ച് പറയൂ.' : 'No words heard. Hold to speak again.');
    }
  }

  function cancelHold() {
    const session = holdRef.current;
    if (!session) return;
    session.cancelled = true;
    session.released = true;
    holdRef.current = null;
    listeningBusy.current = false;
    if (session.watchdog) clearTimeout(session.watchdog);
    session.abort();
    if (!closingRef.current) {
      setText('');
      setState('idle');
    }
  }

  function releaseHold() {
    const session = holdRef.current;
    if (!session || session.released) return;
    session.released = true;
    // stop requests a final result; a late onresult/onend is still accepted.
    session.stop();
    if (session.settled) finishTranscript(session);
    else {
      // WebKit sometimes omits onend. Never leave the mic UI stuck forever:
      // after the grace period, send the last interim text if any.
      session.watchdog = setTimeout(() => finishTranscript(session), 1800);
    }
  }

  function beginHold(): boolean {
    if (closingRef.current || micDialog || holdRef.current || requestBusy.current || listeningBusy.current) return false;
    if (!canListen()) {
      setSpeechIssue({ code: 'api-unavailable', locale: lang === 'ml' ? 'ml-IN' : 'en-IN' });
      setMicDialog('unavailable');
      return false;
    }
    stopSpeaking();
    listeningBusy.current = true;
    setSpeechIssue(null);
    setText('');
    setState('listening');
    const session: HoldSession = {
      pointerId: null, released: false, cancelled: false, settled: false,
      latest: '', final: '', stop: () => {}, abort: () => {}, watchdog: null,
    };
    holdRef.current = session;
    try {
      const recognition = listen(lang, (partial) => {
        if (holdRef.current !== session || session.cancelled) return;
        session.latest = partial;
        if (!closingRef.current) setText(partial);
      }, alternateMalayalam && lang === 'ml');
      session.stop = recognition.stop;
      session.abort = recognition.abort;
      void recognition.done.then((result) => {
        if (holdRef.current !== session || session.cancelled) return;
        session.final = result.trim();
        session.settled = true;
        if (session.released) finishTranscript(session);
        // If the browser ends during a pause, keep recognized text until release.
      }, (error: unknown) => {
        if (holdRef.current !== session || session.cancelled) return;
        if (session.watchdog) clearTimeout(session.watchdog);
        holdRef.current = null;
        listeningBusy.current = false;
        if (closingRef.current) return;
        setState('idle');
        if (error instanceof SpeechListenError) {
          setSpeechIssue({ code: error.browserCode, locale: error.locale });
          setMicDialog(error.reason === 'denied' || error.reason === 'audio' ? 'denied'
            : error.reason === 'unsupported' ? 'unsupported' : 'service');
        } else {
          toast(error instanceof Error ? error.message : String(error), 'bad');
        }
      });
    } catch (error) {
      holdRef.current = null;
      listeningBusy.current = false;
      setState('idle');
      toast(error instanceof Error ? error.message : String(error), 'bad');
      return false;
    }
    return true;
  }

  function onPressDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (activePointer.current !== null || !beginHold()) return;
    activePointer.current = event.pointerId;
    if (holdRef.current) holdRef.current.pointerId = event.pointerId;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Safari may capture implicitly */ }
  }

  function onPressUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    suppressClickUntil.current = Date.now() + 800;
    event.preventDefault();
    releaseHold();
  }

  function onPressCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    suppressClickUntil.current = Date.now() + 800;
    cancelHold(); // A cancelled gesture must never create a payment command.
  }

  function onHoldKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat || keyboardHeld.current) return;
    keyboardHeld.current = beginHold();
  }

  function onHoldKeyUp(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!keyboardHeld.current) return;
    keyboardHeld.current = false;
    suppressClickUntil.current = Date.now() + 800;
    releaseHold();
  }

  function onAccessibleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    // Ignore synthetic clicks after a pointer/keyboard release. VoiceOver's
    // click without a pointer has detail=0, so it can toggle accessibly.
    if (event.detail > 0 || Date.now() < suppressClickUntil.current) return;
    if (holdRef.current) releaseHold();
    else beginHold();
  }

  function useKeyboard() {
    setMicDialog(null);
    // iOS only opens the keyboard reliably from the direct tap gesture.
    inputRef.current?.focus();
    requestAnimationFrame(() => {
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    });
  }

  // Visibility loss cancels (rather than sends) a partial voice command.
  // Only a deliberate release of the held microphone can auto-send.
  useEffect(() => {
    function onHidden() {
      if (!document.hidden) return;
      const session = holdRef.current;
      if (!session) return;
      session.cancelled = true;
      holdRef.current = null;
      activePointer.current = null;
      keyboardHeld.current = false;
      listeningBusy.current = false;
      if (session.watchdog) clearTimeout(session.watchdog);
      session.abort();
      setText('');
      setState('idle');
    }
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, []);

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

  const status = state === 'listening' ? (lang === 'ml' ? 'പിടിച്ചുനിൽക്കൂ · വിട്ടാൽ അയയ്ക്കും' : 'Keep holding · release to send')
    : state === 'thinking' ? (lang === 'ml' ? 'ആലോചിക്കുന്നു…' : 'Thinking…')
    : state === 'speaking' ? (lang === 'ml' ? 'സംസാരിക്കുന്നു…' : 'Speaking…')
      : voiceOk ? (lang === 'ml'
        ? (alternateMalayalam ? 'മലയാളം (ml) · അമർത്തിപ്പിടിച്ച് സംസാരിക്കൂ' : 'അമർത്തിപ്പിടിച്ച് സംസാരിക്കൂ · വിട്ടാൽ അയയ്ക്കും')
        : 'Hold to talk · Release to send')
      : (lang === 'ml' ? 'മലയാളം ടൈപ്പ് ചെയ്യാം' : 'Type your message');

  return (
    <Sheet title="XS AI" onClosing={stopInteraction} onClose={() => { stopInteraction(); onClose(); }}>
      <div className="xsai">
        <div className="xsai-bar">
          <Segmented label="Language" value={lang} onChange={(value) => {
            cancelHold(); setLang(value); setMicDialog(null);
            setSpeechIssue(null); setAlternateMalayalam(false);
          }} options={[{ value: 'en', label: 'English' }, { value: 'ml', label: 'മലയാളം' }]} />
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
          <button type="button" className={`xsai-orb ${state}`}
            onPointerDown={onPressDown} onPointerUp={onPressUp} onPointerCancel={onPressCancel}
            onLostPointerCapture={onPressCancel}
            onKeyDown={onHoldKeyDown} onKeyUp={onHoldKeyUp}
            onContextMenu={(event) => event.preventDefault()}
            onClick={onAccessibleClick} disabled={state === 'thinking'}
            aria-pressed={state === 'listening'}
            aria-label={state === 'listening' ? 'Release to send' : 'Hold to talk to XS AI'}>
            <span className="xsai-orb-glow" aria-hidden />
            {state === 'listening' ? <Square size={22} fill="currentColor" /> : <Mic size={26} />}
          </button>
          <p className="xsai-status" aria-live="polite">{status}{lang === 'ml' && !mute && !voiceFor('ml') ? ' · replies shown as text on this device' : ''}</p>
          <form className="xsai-type" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <input ref={inputRef} className="input" lang={lang === 'ml' ? 'ml-IN' : 'en-IN'} value={text} onChange={(e) => setText(e.target.value)} placeholder={lang === 'ml' ? 'ടൈപ്പ് ചെയ്യൂ…' : 'Type a message…'} aria-label="Message XS AI" enterKeyHint="send" />
            <button className="btn primary icon-btn" disabled={!text.trim() || state !== 'idle'} aria-label="Send"><ArrowUp size={20} /></button>
          </form>
        </div>

        {micDialog && (
          <div className="xsai-mic-backdrop">
            <section className="xsai-mic-dialog" role="dialog" aria-modal="true" aria-labelledby="xsai-mic-heading" aria-describedby="xsai-mic-desc">
              <span className="xsai-mic-icon" aria-hidden><Mic size={27} strokeWidth={1.8} /></span>
              <h3 id="xsai-mic-heading">{MIC_COPY[lang][micDialog].title}</h3>
              <p id="xsai-mic-desc">{MIC_COPY[lang][micDialog].detail}</p>
              {speechIssue && (
                <p className="muted" role="status">
                  Browser error: <code>{speechIssue.code}</code> · language <code>{speechIssue.locale}</code>
                </p>
              )}
              {lang === 'ml' && <p className="muted">
                No XS Gym recording, AI model, or audio upload is used. Safari and installed iPhone apps may differ.
                Malayalam browser recognition is not guaranteed.
              </p>}
              <div className="xsai-mic-actions">
                {micDialog !== 'unavailable' && (
                  <button ref={micActionRef} type="button" className="btn primary"
                    onClick={() => { setMicDialog(null); setSpeechIssue(null); }}>
                    
                    {MIC_COPY[lang][micDialog].button}
                  </button>
                )}
                {lang === 'ml' && speechIssue?.locale === 'ml-IN' && micDialog !== 'denied' && (
                  <button type="button" className="btn ghost"
                    onClick={() => { setAlternateMalayalam(true); setMicDialog(null); setSpeechIssue(null); }}>
                    
                    മലയാളം (ml) കോഡ് പരീക്ഷിക്കുക
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
