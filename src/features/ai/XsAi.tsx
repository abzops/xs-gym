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
import { sttInputMode } from './sttPreferences';
import { listenSarvam } from './sarvamRealtime';
import { captureMalayalamBackup, transcribeFailedNative, type MalayalamClip } from './malayalamBackup';
import './ai.css';

type Action = { tool: string; ok: boolean; summary: string; undo?: { rpc: string; args: Record<string, unknown> }; undone?: boolean };
type Turn = { role: 'user' | 'assistant'; content: string; actions?: Action[]; tone?: 'bad'; id?: string; voicePending?: boolean };
type State = 'idle' | 'thinking';
type MicDialog = 'denied' | 'unavailable' | 'service' | 'unsupported' | null;

type HoldSession = {
  pointerId: number | null;
  released: boolean;
  cancelled: boolean;
  settled: boolean;
  cloud: boolean;
  backup: ReturnType<typeof captureMalayalamBackup> | null;
  backupClip: Promise<MalayalamClip | null> | null;
  nativeFailed: boolean;
  uploading: boolean;
  pendingId: string | null;
  latest: string;
  final: string;
  failed: unknown | null;
  stop: () => void;
  abort: () => void;
  watchdog: ReturnType<typeof setTimeout> | null;
};

// XS AI sends text commands only. Native browser voice is default.
// Opt-in Sarvam audio uses a separate authenticated relay, never xs-ai.

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
  const [, setSpeechIssue] = useState<{ code: string; locale: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const holdRef = useRef<HoldSession | null>(null);
  const activePointer = useRef<number | null>(null);
  const keyboardHeld = useRef(false);
  const pendingUnavailable = useRef(false);
  const unavailableMalayalam = useRef((() => {
    try { return localStorage.getItem('xs-ai-native-ml-unavailable') === '1'; }
    catch { return false; }
  })());
  const suppressClickUntil = useRef(0);
  const [alternateMalayalam, setAlternateMalayalam] = useState(false);
  const closingRef = useRef(false);
  const requestBusy = useRef(false);
  const listeningBusy = useRef(false);
  const undoBusy = useRef(new Set<string>());
  const commandQueue = useRef<Array<{ content: string; language: Lang; id: string; cloudVoice: boolean }>>([]);
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
  function ask(content: string, fromVoice = false, pendingId?: string, cloudVoice = false) {
    const q = content.trim();
    if (!q || closingRef.current) return;
    const command = { content: q, language: lang, id: crypto.randomUUID(), cloudVoice };
    commandQueue.current.push(command);
    // Messenger behavior: replace the provisional outgoing voice bubble in-place
    // instead of popping it off and appending a second copy.
    const containsPending = !!pendingId && turnsRef.current.some((turn) => turn.id === pendingId);
    const updated: Turn[] = containsPending
      ? turnsRef.current.map((turn) => turn.id === pendingId
          ? { role: 'user', content: q, id: pendingId } : turn)
      : [...turnsRef.current, { role: 'user', content: q }];
    turnsRef.current = updated;
    setTurns(updated);
    // Do not erase a new typed draft when a delayed recognition finishes.
    if (!fromVoice) setText('');
    void drainQueue();
  }
  function removeVoicePending(pendingId: string | null) {
    if (!pendingId) return;
    const updated = turnsRef.current.filter((turn) => turn.id !== pendingId);
    turnsRef.current = updated;
    setTurns(updated);
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
              cloudVoice: next.cloudVoice,
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

  // iPhone and Android use pointerdown/up, not click-to-toggle. Browser speech
  // starts first. Consent-enabled Sarvam retries after a browser failure.
  function finishTranscript(session: HoldSession) {
    if (holdRef.current !== session || session.cancelled || !session.released) return;
    if (session.watchdog) clearTimeout(session.watchdog);
    holdRef.current = null;
    listeningBusy.current = false;
    setHolding(false);
    if (closingRef.current) return;
    if (session.failed) {
      session.backup?.abort();
      removeVoicePending(session.pendingId);
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
    // Cloud transcripts require an actual finalized result; browser interim text
    // may be used on Safari when onend is dropped after finger-up.
    const heard = (session.cloud ? session.final : session.final || session.latest).trim();
    session.backup?.abort();
    if (heard) ask(heard, true, session.pendingId ?? undefined, session.cloud);
    else removeVoicePending(session.pendingId);
  }

  // The captured clip is local until native recognition actually fails.
  // Uploading only after finger-up preserves the beginning of the sentence.
  function recoverMalayalam(session: HoldSession) {
    if (!session.released || session.cancelled || session.uploading ||
      holdRef.current !== session || !session.backup) return;
    session.uploading = true;
    session.cloud = true; // server enforces READ-ONLY actions for cloud speech
    session.settled = false;
    session.failed = null;
    if (session.watchdog) clearTimeout(session.watchdog);
    session.watchdog = setTimeout(() => {
      if (holdRef.current !== session || session.cancelled) return;
      session.failed = new SpeechListenError('service', 'Malayalam transcription timed out.', 'cloud-timeout', 'ml-IN');
      session.settled = true;
      finishTranscript(session);
    }, 27_000);
    void (session.backupClip ?? session.backup.stop())
      .then((clip) => transcribeFailedNative(gym.id, clip))
      .then((text) => {
        if (session.cancelled || holdRef.current !== session) return;
        session.final = text.trim();
        session.settled = true;
        if (text.trim()) {
          unavailableMalayalam.current = true;
          try { localStorage.setItem('xs-ai-native-ml-unavailable', '1'); } catch { /* private mode */ }
        }
        finishTranscript(session);
      }, (error: unknown) => {
        if (session.cancelled || holdRef.current !== session) return;
        session.failed = error;
        session.settled = true;
        finishTranscript(session);
      });
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
    session.backup?.abort();
    removeVoicePending(session.pendingId);
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
    // Stop local capture immediately. Its bytes are uploaded ONLY if browser
    // Malayalam fails, after the user already released the button.
    if (session.backup) session.backupClip = session.backup.stop();
    // Place the message in the conversation immediately. The actual text
    // replaces this quiet placeholder once speech recognition finalizes.
    const pendingId = crypto.randomUUID();
    session.pendingId = pendingId;
    const placeholder: Turn = { role: 'user', id: pendingId, content: session.latest, voicePending: true };
    turnsRef.current = [...turnsRef.current, placeholder];
    setTurns(turnsRef.current);
    // Do not call stop() again when the browser has already ended/failed;
    // WebKit iOS 27 has a reported repeated-recognition regression.
    if (!session.settled) session.stop();
    if (session.nativeFailed && session.backup) recoverMalayalam(session);
    else if (session.settled) finishTranscript(session);
    else {
      session.watchdog = setTimeout(() => {
        if (holdRef.current !== session || session.cancelled) return;
        if (session.backup && !session.cloud && !(session.final || session.latest).trim()) {
          session.nativeFailed = true;
          recoverMalayalam(session);
          return;
        }
        if (session.cloud && !session.settled)
          session.failed = new SpeechListenError('service', 'Cloud speech did not finish.', 'cloud-timeout', lang);
        finishTranscript(session);
      }, session.backup ? 2100 : session.cloud ? 6000 : 1800);
    }
  }

  function beginHold(): boolean {
    if (closingRef.current || holdRef.current || listeningBusy.current) return false;
    setMicDialog(null);
    // Sarvam is never first choice unless this session has already seen
    // a browser Malayalam failure (or there is no browser speech API).
    const canFallback = lang === 'ml' && sttInputMode() === 'sarvam';
    const useSarvam = canFallback && (unavailableMalayalam.current || !canListen());
    if (!useSarvam && !canListen()) {
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
      cloud: useSarvam,
      backup: !useSarvam && canFallback ? captureMalayalamBackup() : null,
      backupClip: null, nativeFailed: false, uploading: false,
      pendingId: null, latest: '', final: '', failed: null,
      stop: () => {}, abort: () => {}, watchdog: null,
    };
    holdRef.current = session;
    try {
      const onPartial = (partial: string) => {
        if (holdRef.current !== session || session.cancelled) return;
        session.latest = partial;
        if (!closingRef.current && !session.released) setText(partial);
      };
      // Try both native Malayalam locale tags before invoking a previously
      // consented cloud provider; Safari support varies by browser version.
      let browserShortLocale = alternateMalayalam && lang === 'ml';
      const startProvider = (cloud: boolean) => {
        session.cloud = cloud;
        const recognition = cloud
          ? listenSarvam(gym.id, lang, onPartial)
          : listen(lang, onPartial, browserShortLocale);
        session.stop = recognition.stop;
        session.abort = recognition.abort;
        void recognition.done.then((result) => {
          if (holdRef.current !== session || session.cancelled) return;
          session.final = result.trim();
          if (!cloud && session.backup && (
            !session.final ||
            (!/[\u0D00-\u0D7F]/u.test(session.final) &&
              /[A-Za-z]/u.test(session.final) && session.final.split(/\s+/u).length >= 2)
          )) {
            // Empty or Latin-only transcription while Malayalam is selected:
            // recover the ORIGINAL audio rather than asking to repeat speech.
            session.nativeFailed = true;
            if (session.released) recoverMalayalam(session);
            return;
          }
          if (!cloud && !session.final && lang === 'ml' && !session.latest.trim()) {
            if (!browserShortLocale) setAlternateMalayalam(true);
            else if (canFallback) unavailableMalayalam.current = true;
          }
          if (!cloud && session.final && lang === 'ml' && /[\u0D00-\u0D7F]/u.test(session.final)) {
            unavailableMalayalam.current = false;
            try { localStorage.removeItem('xs-ai-native-ml-unavailable'); } catch { /* private mode */ }
          }
          session.backup?.abort(); // native transcript succeeded: discard local audio
          session.settled = true;
          if (session.released) finishTranscript(session);
        }, (error: unknown) => {
          if (holdRef.current !== session || session.cancelled) return;
          const browserError = error instanceof SpeechListenError ? error : null;
          if (!cloud && session.backup && browserError &&
              ['no-speech', 'language-not-supported', 'service-not-allowed', 'network'].includes(browserError.browserCode)) {
            // Keep capturing until finger-up; no cloud upload before failure.
            session.nativeFailed = true;
            if (session.released) recoverMalayalam(session);
            return;
          }
          if (!cloud && browserError?.browserCode === 'no-speech') {
            if (lang === 'ml') {
              if (!browserShortLocale) setAlternateMalayalam(true);
              else if (canFallback) unavailableMalayalam.current = true;
            }
            // A silent press never creates an error message or AI command.
            session.final = '';
            session.latest = '';
            session.failed = null;
            session.settled = true;
            if (session.released) finishTranscript(session);
            return;
          }
          const eligible = browserError &&
            ['unsupported', 'service', 'network'].includes(browserError.reason);
          // The short 'ml' locale succeeds on some builds that reject ml-IN.
          // Retry within the same physical hold (never after release).
          if (!cloud && lang === 'ml' && eligible &&
              browserError.reason === 'unsupported' && !browserShortLocale) {
            browserShortLocale = true;
            setAlternateMalayalam(true);
            if (!session.released) {
              session.final = '';
              session.latest = '';
              session.failed = null;
              session.settled = false;
              startProvider(false);
              return;
            }
          }
          if (!cloud && canFallback && eligible) {
            // Browser speech has failed. Cloud audio is never sent without the
            // explicit per-device Settings opt-in.
            unavailableMalayalam.current = browserError.reason !== 'network';
            if (!session.released) {
              session.final = '';
              session.latest = '';
              session.failed = null;
              session.settled = false;
              startProvider(true);
              return;
            }
          }
          session.failed = error;
          session.settled = true;
          if (session.released) finishTranscript(session);
        });
      };
      startProvider(useSarvam);
    } catch (error) {
      session.backup?.abort();
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
    else if (!canListen() && !(lang === 'ml' && sttInputMode() === 'sarvam')) {
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
      session.backup?.abort();
      removeVoicePending(session.pendingId);
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
    <Sheet instant title="XS AI" onClosing={stopInteraction} onClose={() => { stopInteraction(); onClose(); }}>
      <div className="xsai">
        <div className="xsai-locale-row">
          {turns.length > 0 && (
            <button type="button" className="xsai-new" title="New conversation" aria-label="New conversation"
              onClick={newConversation} disabled={state === 'thinking' || holding}>
              <Plus size={18} strokeWidth={1.8} />
            </button>
          )}
          <Segmented label="Language" value={lang} onChange={(value) => {
            cancelHold(); setLang(value); setMicDialog(null);
            setSpeechIssue(null); setAlternateMalayalam(false);
          }} options={[{ value: 'en', label: 'English' }, { value: 'ml', label: 'മലയാളം' }]} />
        </div>

        <div className="xsai-log" ref={scroller} aria-live="polite">
          {turns.length === 0 && (
            <div className="xsai-welcome">
              <div className="xsai-welcome-visual" aria-hidden="true">
                <span className="xsai-orbit xsai-orbit-outer" />
                <span className="xsai-orbit xsai-orbit-inner" />
                <span className="xsai-welcome-mark"><Sparkles size={34} strokeWidth={1.4} /></span>
              </div>
              <span className="xsai-kicker">XS AI AGENT</span>
              <h3>{lang === 'ml' ? 'ഇന്ന് എന്ത് സഹായമാണ് വേണ്ടത്?' : 'What can I take care of?'}</h3>
              <p className="xsai-welcome-sub">
                {lang === 'ml' ? 'ജിം കാര്യങ്ങൾ ചോദിക്കൂ, ഞാൻ സഹായിക്കാം.' : 'Your gym, one conversation away.'}
              </p>
              <div className="xsai-shortcuts" aria-label="Quick questions">
                {QUICK_PROMPTS[lang].map((prompt) => (
                  <button type="button" key={prompt.icon} className="xsai-shortcut"
                    onClick={() => ask(prompt.prompt)}>
                    <span className="xsai-shortcut-icon" aria-hidden="true">
                      {prompt.icon === 'wallet' ? <Wallet size={18} /> :
                        prompt.icon === 'members' ? <Users size={18} /> : <CalendarClock size={18} />}
                    </span>
                    <span>{prompt.title}</span>
                    <ArrowUp size={15} className="xsai-shortcut-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, ti) => (
            <div key={t.id ?? ti} className={`xsai-turn ${t.role} ${t.tone ?? ''}`}>
              {t.role === 'assistant' && (
                <span className="xsai-turn-avatar" aria-hidden="true"><Sparkles size={15} strokeWidth={1.8} /></span>
              )}
              <div className="xsai-turn-body">
                {(t.content || t.voicePending) && (
                  <p className={'xsai-bubble' + (t.voicePending ? ' xsai-voice-pending' : '')}
                    aria-label={t.voicePending ? 'Finishing voice message' : undefined}>
                    {t.content || (t.voicePending ? <Mic size={15} strokeWidth={1.8} aria-hidden="true" /> : null)}
                  </p>
                )}
                {t.actions?.map((a, i) => (
                  <div key={i} className={`xsai-action ${a.ok ? (a.undone ? 'undone' : 'ok') : 'bad'}`}>
                    <span className="xsai-action-ico" aria-hidden="true">
                      {a.ok ? <Check size={14} strokeWidth={2.5} /> : <X size={14} strokeWidth={2.5} />}
                    </span>
                    <div className="xsai-action-content">
                      <span className="xsai-action-status">{a.undone ? 'Reversed' : a.ok ? 'Completed' : 'Needs attention'}</span>
                      <span className="xsai-action-text">{a.undone ? <s>{a.summary}</s> : a.summary}</span>
                    </div>
                    {a.ok && a.undo && !a.undone && (
                      <button type="button" className="xsai-undo" onClick={() => undo(ti, i)}>
                        <RotateCcw size={13} /> Undo
                      </button>
                    )}
                  </div>
                ))}
                {t.role === 'assistant' && t.content && !t.tone && (
                  <button type="button" className="xsai-copy"
                    aria-label={copiedTurn === ti ? 'Reply copied' : 'Copy reply'}
                    onClick={() => void copyReply(ti, t.content)}>
                    {copiedTurn === ti ? <CheckCheck size={14} /> : <Copy size={14} />}
                    <span>{copiedTurn === ti ? 'Copied' : 'Copy'}</span>
                  </button>
                )}
              </div>
            </div>
          ))}
          {state === 'thinking' && (
            <div className="xsai-turn assistant xsai-pending">
              <span className="xsai-turn-avatar" aria-hidden="true"><Sparkles size={15} strokeWidth={1.8} /></span>
              <div className="xsai-turn-body">
                <p className="xsai-bubble xsai-dots" aria-label="Waiting for reply"><i /><i /><i /></p>
              </div>
            </div>
          )}
        </div>

        <div className={`xsai-controls ${holding ? 'is-listening' : ''}`}>
          <div className="xsai-voice-zone">
            <button type="button" className={`xsai-orb ${holding ? 'listening' : ''}`}
              onPointerDown={onPressDown} onPointerUp={onPressUp} onPointerCancel={onPressCancel}
              onLostPointerCapture={onPressCancel}
              onKeyDown={onHoldKeyDown} onKeyUp={onHoldKeyUp}
              onContextMenu={(event) => event.preventDefault()}
              onDragStart={(event) => event.preventDefault()}
              onClick={onAccessibleClick}
              aria-pressed={holding}
              aria-label={holding ? 'Release to send' : 'Hold to talk to XS AI'}>
              <span className="xsai-orb-glow" aria-hidden="true" />
              <Mic size={27} strokeWidth={1.85} aria-hidden="true" />
              <span className="xsai-hold-waves" aria-hidden="true"><i /><i /><i /><i /></span>
            </button>
            <span className="xsai-voice-caption" aria-hidden="true">
              {holding ? 'Release to send' : 'Hold to talk'}
            </span>
          </div>
          <div className="xsai-composer">
            <form className="xsai-type" onSubmit={(event) => { event.preventDefault(); ask(text); }}>
              <input ref={inputRef} className="input" lang={lang === 'ml' ? 'ml-IN' : 'en-IN'}
                value={text} onChange={(event) => setText(event.target.value)}
                placeholder={lang === 'ml' ? 'എന്തെങ്കിലും ചോദിക്കൂ…' : 'Ask XS AI anything…'}
                aria-label="Message XS AI" enterKeyHint="send" />
              <button className="xsai-send" disabled={!text.trim() || holding} aria-label="Send">
                <ArrowUp size={19} strokeWidth={2.4} />
              </button>
            </form>
          </div>
          <span className="sr-only" role="status">{holding ? 'Listening' : ''}</span>
          {micDialog && (
            <div className="xsai-inline-issue" role="status">
              <span>
                {micDialog === 'denied' ? 'Microphone access needed' :
                  micDialog === 'unsupported' ? 'Voice not supported here' : 'Could not hear that'}
              </span>
              <button type="button" onClick={() => { setMicDialog(null); inputRef.current?.focus(); }}>Type</button>
              <button type="button" aria-label="Dismiss voice message" onClick={() => setMicDialog(null)}><X size={14} /></button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
