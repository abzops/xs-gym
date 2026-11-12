import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, CheckCheck, Copy, Mic, Plus, RotateCcw, Sparkles, Users, Wallet, CalendarClock, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import { canListen, listen, speak, SpeechListenError, stopSpeaking, type Lang } from './voice';
import { spokenRepliesEnabled } from './preferences';
import './ai.css';

type Action = { tool: string; ok: boolean; summary: string; undo?: { rpc: string; args: Record<string, unknown> }; undone?: boolean };
type Turn = { role: 'user' | 'assistant'; content: string; actions?: Action[]; tone?: 'bad' };
type State = 'idle' | 'thinking';
type MicDialog = 'denied' | 'unavailable' | 'service' | 'unsupported' | null;

type HoldSession = {
  pointerId: number | null;
  released: boolean;
  cancelled: boolean;
  settled: boolean;
  latest: string;
  final: string;
  failed: unknown | null;
  stop: () => void;
  abort: () => void;
  watchdog: ReturnType<typeof setTimeout> | null;
};

// XS AI sends typed text only. Audio recording/upload is intentionally disabled.
// Live word-by-word recognition uses the browser's SpeechRecognition interface.

const LANG_KEY = 'xs-ai-lang';
// Read-only example requests: these never contain an instruction to change a
// payment or membership. They disappear after the conversation begins.
const QUICK_PROMPTS: Record<Lang, { title: string; prompt: string; icon: 'wallet' | 'members' | 'renewals' }[]> = {
  en: [
    { title: "Today's collections", prompt: 'How much did we collect today?', icon: 'wallet' },
    { title: 'Pending dues', prompt: 'Who has pending membership dues?', icon: 'members' },
    { title: 'Upcoming renewals', prompt: 'Which memberships are due for renewal soon?', icon: 'renewals' },
  ],
  ml: [
    { title: 'ഇന്നത്തെ കളക്ഷൻ', prompt: 'ഇന്ന് എത്ര രൂപ കളക്ട് ചെയ്തു?', icon: 'wallet' },
    { title: 'കുടിശ്ശിക', prompt: 'ആർക്കൊക്കെ മെമ്പർഷിപ്പ് കുടിശ്ശികയുണ്ട്?', icon: 'members' },
    { title: 'പുതുക്കേണ്ടത്', prompt: 'അടുത്തതായി ആരുടെയൊക്കെ മെമ്പർഷിപ്പ് പുതുക്കണം?', icon: 'renewals' },
  ],
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
  const [copiedTurn, setCopiedTurn] = useState<number | null>(null);
  const [holding, setHolding] = useState(false);
  const [micDialog, setMicDialog] = useState<MicDialog>(null);
  const [speechIssue, setSpeechIssue] = useState<{ code: string; locale: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const holdRef = useRef<HoldSession | null>(null);
  const activePointer = useRef<number | null>(null);
  const keyboardHeld = useRef(false);
  const pendingUnavailable = useRef(false);
  const suppressClickUntil = useRef(0);
  const [alternateMalayalam, setAlternateMalayalam] = useState(false);
  const closingRef = useRef(false);
  const requestBusy = useRef(false);
  const listeningBusy = useRef(false);
  const undoBusy = useRef(new Set<string>());
  const commandQueue = useRef<Array<{ content: string; language: Lang; id: string }>>([]);
  const processedHistory = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const turnsRef = useRef(turns); turnsRef.current = turns;


  useEffect(() => { try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ } }, [lang]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [turns, state]);

  const stopInteraction = useCallback(() => {
    closingRef.current = true;
    activePointer.current = null;
    keyboardHeld.current = false;
    pendingUnavailable.current = false;
    const session = holdRef.current;
    holdRef.current = null;
    listeningBusy.current = false;
    commandQueue.current = [];
    if (session) {
      session.cancelled = true;
      if (session.watchdog) clearTimeout(session.watchdog);
      session.abort();
    }
    stopSpeaking();
    setHolding(false);
  }, []);
  useEffect(() => () => { stopInteraction(); }, [stopInteraction]);

  // Voice replies are opt-in per device. A request's typed response always
  // appears in the chat, and the microphone never waits for speech playback.
  // Serialize money-changing commands: holding again while the first request
  // is pending queues the new text without overlapping server actions.
  function ask(content: string, fromVoice = false) {
    const q = content.trim();
    if (!q || closingRef.current) return;
    const command = { content: q, language: lang, id: crypto.randomUUID() };
    commandQueue.current.push(command);
    const updated: Turn[] = [...turnsRef.current, { role: 'user', content: q }];
    turnsRef.current = updated;
    setTurns(updated);
    // A late speech result must not clear text the user started typing after release.
    if (!fromVoice) setText('');
    void drainQueue();
  }

  async function drainQueue() {
    if (requestBusy.current || closingRef.current) return;
    requestBusy.current = true;
    setState('thinking');
    try {
      while (!closingRef.current && commandQueue.current.length) {
        const next = commandQueue.current.shift()!;
        stopSpeaking();
        const history = [...processedHistory.current, { role: 'user' as const, content: next.content }];
        processedHistory.current = history;
        try {
          const { data, error } = await supabase.functions.invoke('xs-ai', {
            body: {
              gym_id: gym.id, lang: next.language, request_id: next.id,
              messages: history,
            },
          });
          if (error) {
            let msg = errorMessage(error);
            try { const body = await (error as { context?: Response }).context?.json(); if (body?.error) msg = body.error; }
            catch { /* not JSON */ }
            throw new Error(msg);
          }
          const reply = String(data?.reply ?? '');
          for (const key of data?.changed ?? []) void qc.invalidateQueries({ queryKey: [key, gym.id] });
          if (closingRef.current) break;
          const answer: Turn = { role: 'assistant', content: reply, actions: data?.actions };
          turnsRef.current = [...turnsRef.current, answer];
          setTurns(turnsRef.current);
          processedHistory.current = [...history, { role: 'assistant', content: reply }];
          if (typeof data?.navigate === 'string') {
            navigate(`/g/${gym.slug}${data.navigate ? `/${data.navigate}` : ''}`);
          }
          if (reply && spokenRepliesEnabled()) {
            // Never hold up the microphone waiting for TTS completion.
            void speak(reply, next.language);
          }
        } catch (error) {
          if (closingRef.current) break;
          const answer: Turn = {
            role: 'assistant', content: error instanceof Error ? error.message : String(error), tone: 'bad',
          };
          turnsRef.current = [...turnsRef.current, answer];
          setTurns(turnsRef.current);
        }
      }
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
    setHolding(false);
    if (closingRef.current) return;
    if (session.failed) {
      // Only an actual recognition failure shows a short inline message.
      // Normal releases never display banners or spoken status.
      const error = session.failed;
      if (error instanceof SpeechListenError) {
        // iOS synthesizes a click after pointerup. Mounting a modal inside that
        // event can put its retry/dismiss control under the releasing finger.
        // Open after the gesture finishes, so it cannot be clicked accidentally.
        setTimeout(() => {
          if (closingRef.current || holdRef.current) return;
          setSpeechIssue({ code: error.browserCode, locale: error.locale });
          setMicDialog(error.reason === 'denied' || error.reason === 'audio' ? 'denied'
            : error.reason === 'unsupported' ? 'unsupported' : 'service');
        }, 80);
      } else setMicDialog('service');
      return;
    }
    const heard = (session.final || session.latest).trim();
    if (heard) ask(heard, true); // Only release can send; silence sends nothing.
  }

  function cancelHold() {
    const session = holdRef.current;
    if (!session) return;
    session.cancelled = true;
    session.released = true;
    holdRef.current = null;
    listeningBusy.current = false;
    setHolding(false);
    if (session.watchdog) clearTimeout(session.watchdog);
    session.abort();
    if (!closingRef.current) setText('');
  }

  function releaseHold() {
    const session = holdRef.current;
    if (!session || session.released) return;
    session.released = true;
    // The mic is visually idle IMMEDIATELY on finger-up, even while the
    // browser finalizes text and the previous AI reply is processing.
    setHolding(false);
    setText('');
    // Do not call stop() again when the browser has already ended/failed;
    // WebKit iOS 27 has a reported repeated-recognition regression.
    if (!session.settled) session.stop();
    if (session.settled) finishTranscript(session);
    else {
      // WebKit sometimes omits onend. Never leave the mic UI stuck forever:
      // after the grace period, send the last interim text if any.
      session.watchdog = setTimeout(() => finishTranscript(session), 1800);
    }
  }

  function beginHold(): boolean {
    if (closingRef.current || holdRef.current || listeningBusy.current) return false;
    setMicDialog(null);
    if (!canListen()) {
      // Delay the error overlay until pointerup. If it appears while a finger
      // is down, releasing can click an action in the newly mounted dialog.
      pendingUnavailable.current = true;
      setSpeechIssue({ code: 'api-unavailable', locale: lang === 'ml' ? 'ml-IN' : 'en-IN' });
      return true;
    }
    stopSpeaking();
    listeningBusy.current = true;
    setSpeechIssue(null);
    setText('');
    setHolding(true);
    const session: HoldSession = {
      pointerId: null, released: false, cancelled: false, settled: false,
      latest: '', final: '', failed: null, stop: () => {}, abort: () => {}, watchdog: null,
    };
    holdRef.current = session;
    try {
      const recognition = listen(lang, (partial) => {
        if (holdRef.current !== session || session.cancelled) return;
        session.latest = partial;
        if (!closingRef.current && !session.released) setText(partial);
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
        session.failed = error;
        session.settled = true;
        // Finger may still be held. Wait for release before showing any modal.
        if (session.released) finishTranscript(session);
      });
    } catch (error) {
      holdRef.current = null;
      listeningBusy.current = false;
      setHolding(false);
      setMicDialog('service');
      return false;
    }
    return true;
  }

  function finishGesture() {
    if (pendingUnavailable.current) {
      pendingUnavailable.current = false;
      setTimeout(() => {
        if (!closingRef.current) setMicDialog('unavailable');
      }, 80);
      return;
    }
    releaseHold();
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
    finishGesture();
  }

  function onPressCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    suppressClickUntil.current = Date.now() + 800;
    pendingUnavailable.current = false;
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
    finishGesture();
  }

  function onAccessibleClick(event: ReactMouseEvent<HTMLButtonElement>) {
    // Ignore synthetic clicks after a pointer/keyboard release. VoiceOver's
    // click without a pointer has detail=0, so it can toggle accessibly.
    if (event.detail > 0 || Date.now() < suppressClickUntil.current) return;
    if (holdRef.current) releaseHold();
    else if (!canListen()) {
      setSpeechIssue({ code: 'api-unavailable', locale: lang === 'ml' ? 'ml-IN' : 'en-IN' });
      setMicDialog('unavailable');
    } else beginHold();
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
      pendingUnavailable.current = false;
      listeningBusy.current = false;
      if (session.watchdog) clearTimeout(session.watchdog);
      session.abort();
      setHolding(false);
      setText('');
    }
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, []);

  // Keep real backend actions and their audit trail untouched. This is a
  // UI-only reset and cannot run while requests or microphone use are active.
  function newConversation() {
    if (requestBusy.current || commandQueue.current.length || holdRef.current || listeningBusy.current) return;
    stopSpeaking();
    processedHistory.current = [];
    commandQueue.current = [];
    turnsRef.current = [];
    setTurns([]);
    setText('');
    setCopiedTurn(null);
    setMicDialog(null);
    setSpeechIssue(null);
  }

  async function copyReply(turn: number, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedTurn(turn);
    } catch {
      toast('Could not copy', 'bad');
    }
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

  return (
    <Sheet title="XS AI" onClosing={stopInteraction} onClose={() => { stopInteraction(); onClose(); }}>
      <div className="xsai">
        <div className="xsai-bar">
          <Segmented label="Language" value={lang} onChange={(value) => {
            cancelHold(); setLang(value); setMicDialog(null);
            setSpeechIssue(null); setAlternateMalayalam(false);
          }} options={[{ value: 'en', label: 'English' }, { value: 'ml', label: 'മലയാളം' }]} />
        </div>

        <div className="xsai-log" ref={scroller} aria-live="polite">
          {turns.map((t, ti) => (
            <div key={ti} className={`xsai-turn ${t.role} ${t.tone ?? ''}`}>
              {t.actions?.map((a, i) => (
                <div key={i} className={`xsai-action ${a.ok ? (a.undone ? 'undone' : 'ok') : 'bad'}`}>
                  <span className="xsai-action-ico" aria-hidden>{a.ok ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}</span>
                  <span className="xsai-action-text">{a.undone ? <s>{a.summary}</s> : a.summary}</span>
                  {a.ok && a.undo && !a.undone && (
                    <button type="button" className="btn small ghost" onClick={() => undo(ti, i)}>
                      <RotateCcw size={14} /> Undo
                    </button>
                  )}
                </div>
              ))}
              {t.content && <p className="xsai-bubble">{t.content}</p>}
            </div>
          ))}
          {state === 'thinking' && (
            <div className="xsai-turn assistant">
              <p className="xsai-bubble xsai-dots" aria-label="Waiting for reply"><i /><i /><i /></p>
            </div>
          )}
        </div>

        <div className="xsai-controls">
          <button type="button" className={`xsai-orb ${holding ? 'listening' : ''}`}
            onPointerDown={onPressDown} onPointerUp={onPressUp} onPointerCancel={onPressCancel}
            onLostPointerCapture={onPressCancel}
            onKeyDown={onHoldKeyDown} onKeyUp={onHoldKeyUp}
            onContextMenu={(event) => event.preventDefault()}
            onClick={onAccessibleClick}
            aria-pressed={holding}
            aria-label={holding ? 'Release to send' : 'Hold to talk to XS AI'}>
            <span className="xsai-orb-glow" aria-hidden />
            <Mic size={26} />
          </button>
          <span className="sr-only" role="status">{holding ? 'Listening' : ''}</span>
          {micDialog && (
            <div className="xsai-inline-issue" role="status">
              <span title={speechIssue?.code ?? ''}>
                {micDialog === 'denied' ? 'Microphone blocked' :
                  micDialog === 'unsupported' ? 'Language unavailable' : 'Voice unavailable'}
              </span>
              {lang === 'ml' && !alternateMalayalam && speechIssue?.locale === 'ml-IN' && micDialog !== 'denied' && (
                <button type="button" onClick={() => {
                  setAlternateMalayalam(true); setMicDialog(null); setSpeechIssue(null);
                }}>Try ml</button>
              )}
              <button type="button" onClick={() => { setMicDialog(null); inputRef.current?.focus(); }}>Type</button>
              <button type="button" aria-label="Dismiss voice message" onClick={() => setMicDialog(null)}><X size={14} /></button>
            </div>
          )}
          <form className="xsai-type" onSubmit={(event) => { event.preventDefault(); ask(text); }}>
            <input ref={inputRef} className="input" lang={lang === 'ml' ? 'ml-IN' : 'en-IN'}
              value={text} onChange={(event) => setText(event.target.value)}
              placeholder={lang === 'ml' ? 'ചോദിക്കൂ…' : 'Ask XS AI…'}
              aria-label="Message XS AI" enterKeyHint="send" />
            <button className="btn primary icon-btn" disabled={!text.trim() || holding} aria-label="Send">
              <ArrowUp size={20} />
            </button>
          </form>
        </div>
      </div>
    </Sheet>
  );
}
