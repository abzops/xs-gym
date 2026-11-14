import { useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArrowUp, Ban, CalendarPlus, CalendarX, Check, ClipboardList, Inbox, Mic, Plus, Receipt,
  RotateCcw, Settings, Sparkles, Undo2, UserCog, UserPen, UserPlus, Wallet, X, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import { canRecord, MAX_MS, MicError, startRecording, type Clip, type Recording } from './recorder';
import './ai.css';

type Lang = 'en' | 'ml';
type Pending = { id: string; tool: string; args: Record<string, unknown>; title: string; titleMl: string; lines: string[]; danger?: boolean };
type Action = { tool: string; ok: boolean; summary: string; summaryMl?: string; undo?: { rpc: string; args: Record<string, unknown> }; undone?: boolean };
type Turn = {
  id: string; role: 'user' | 'assistant'; text: string;
  voice?: boolean; listening?: boolean; tone?: 'bad';
  pending?: Pending[]; decision?: 'waiting' | 'running' | 'done' | 'cancelled';
  actions?: Action[];
};
type AgentReply = { reply?: string; heard?: string; pending?: Pending[]; actions?: Action[]; navigate?: string; changed?: string[] };
type MicState = 'idle' | 'starting' | 'recording';

const LANG_KEY = 'xs-ai-lang';
const ICONS: Record<string, LucideIcon> = {
  record_payment: Wallet, sell_plan: CalendarPlus, add_member: UserPlus, update_member: UserPen,
  set_member_status: Archive, cancel_membership: CalendarX, reverse_payment: Undo2, void_charge: Ban,
  record_expense: Receipt, reverse_expense: Undo2, add_enquiry: Inbox, save_plan: ClipboardList,
  update_gym_settings: Settings, save_staff: UserCog,
};
const CHIPS: Record<Lang, string[]> = {
  ml: ['ഇന്നത്തെ കളക്ഷൻ', 'കുടിശ്ശിക ആർക്കൊക്കെ', 'ഈ ആഴ്ച തീരുന്ന മെമ്പർഷിപ്പുകൾ', 'ഈ മാസത്തെ ലാഭം എത്ര?'],
  en: ["Today's collections", 'Who has dues', 'Memberships ending this week', "This month's profit?"],
};
const T = {
  ml: { hello: 'നമസ്കാരം 👋', sub: 'പറയൂ അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യൂ. എന്ത് മാറ്റം വരുത്തുന്നതിനും മുമ്പ് ഞാൻ ചോദിക്കും.', tryIt: 'ഉദാ: "രാഹുൽ 1500 UPI അടച്ചു"',
    placeholder: 'XS AI-യോട് ചോദിക്കൂ…', listening: 'കേൾക്കുന്നു…', approve: 'Approve', approveAll: 'എല്ലാം Approve', cancel: 'Cancel',
    cancelled: 'റദ്ദാക്കി', running: 'ചെയ്യുന്നു…', undo: 'Undo', undone: 'തിരിച്ചാക്കി', thinking: 'ആലോചിക്കുന്നു…', heard: 'കേൾക്കുന്നു…' },
  en: { hello: 'Hi there 👋', sub: 'Talk or type. I always ask before changing anything.', tryIt: 'Try: "Rahul paid 1500 by UPI"',
    placeholder: 'Ask XS AI…', listening: 'Listening…', approve: 'Approve', approveAll: 'Approve all', cancel: 'Cancel',
    cancelled: 'Cancelled', running: 'Working…', undo: 'Undo', undone: 'Undone', thinking: 'Thinking…', heard: 'Listening…' },
};
const uid = () => crypto.randomUUID();

async function callAgent(body: Record<string, unknown>): Promise<AgentReply> {
  const { data, error } = await supabase.functions.invoke('xs-ai', { body });
  if (error) {
    let msg = errorMessage(error);
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return (data ?? {}) as AgentReply;
}

/** XS AI: talk to the gym. Reads instantly; every change waits for Approve. */
export function XsAiPanel({ onClose }: { onClose: () => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [lang, setLang] = useState<Lang>(() => { try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ml'; } catch { return 'ml'; } });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [mic, setMic] = useState<MicState>('idle');
  const [seconds, setSeconds] = useState(0);
  const t = T[lang];

  const turnsRef = useRef(turns); turnsRef.current = turns;
  const history = useRef<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const closing = useRef(false);
  const rec = useRef<Recording | null>(null);
  const pressAt = useRef(0);
  const meter = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const undoBusy = useRef(new Set<string>());

  useEffect(() => { try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ } }, [lang]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);
  useEffect(() => {
    if (mic !== 'recording') { setSeconds(0); return; }
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, [mic]);
  useEffect(() => () => { closing.current = true; rec.current?.cancel(); rec.current = null; }, []);

  const update = (id: string, patch: Partial<Turn> | ((turn: Turn) => Partial<Turn>)) =>
    setTurns((ts) => ts.map((x) => (x.id === id ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));
  const push = (...add: Turn[]) => setTurns((ts) => [...ts, ...add]);
  const refresh = (keys: string[] = []) => { for (const key of keys) void qc.invalidateQueries({ queryKey: [key, gym.id] }); };

  function show(data: AgentReply) {
    refresh(data.changed);
    const reply = String(data.reply ?? '');
    if (data.pending?.length) {
      push({ id: uid(), role: 'assistant', text: reply, pending: data.pending, decision: 'waiting' });
    } else if (reply) {
      push({ id: uid(), role: 'assistant', text: reply, actions: data.actions });
    }
    if (reply) history.current.push({ role: 'assistant', content: reply + (data.pending?.length ? ` [Waiting for approval: ${data.pending.map((p) => `${p.title}: ${p.lines.join(', ')}`).join('; ')}]` : '') });
    if (typeof data.navigate === 'string') navigate(`/g/${gym.slug}${data.navigate ? `/${data.navigate}` : ''}`);
  }
  function fail(error: unknown) {
    if (closing.current) return;
    push({ id: uid(), role: 'assistant', text: error instanceof Error ? error.message : String(error), tone: 'bad' });
  }

  async function send(content: string) {
    const q = content.trim();
    if (!q || busy || closing.current) return;
    setText('');
    push({ id: uid(), role: 'user', text: q });
    history.current.push({ role: 'user', content: q });
    setBusy(true);
    try { const data = await callAgent({ gym_id: gym.id, lang, messages: history.current.slice(-12) }); if (!closing.current) show(data); }
    catch (e) { fail(e); }
    finally { if (!closing.current) setBusy(false); }
  }

  async function sendVoice(clip: Clip) {
    const id = uid();
    push({ id, role: 'user', text: '', voice: true, listening: true });
    setBusy(true);
    try {
      const data = await callAgent({ gym_id: gym.id, lang, messages: history.current.slice(-11), audio: { data: clip.data, mime: clip.mime } });
      if (closing.current) return;
      const heard = String(data.heard ?? '').trim();
      if (heard) { update(id, { text: heard, listening: false }); history.current.push({ role: 'user', content: heard }); }
      else setTurns((ts) => ts.filter((x) => x.id !== id));
      show(data);
    } catch (e) {
      setTurns((ts) => ts.filter((x) => x.id !== id));
      fail(e);
    } finally { if (!closing.current) setBusy(false); }
  }

  // ---------- approval ----------
  async function decide(turn: Turn, ok: boolean) {
    if (turn.decision !== 'waiting' || !turn.pending?.length) return;
    if (!ok) {
      update(turn.id, { decision: 'cancelled' });
      history.current.push({ role: 'assistant', content: '[The user tapped Cancel. Nothing was changed.]' });
      return;
    }
    update(turn.id, { decision: 'running' });
    try {
      const data = await callAgent({ gym_id: gym.id, lang, approve: turn.pending.map((p) => ({ id: p.id, tool: p.tool, args: p.args })) });
      if (closing.current) return;
      update(turn.id, { decision: 'done', actions: data.actions });
      refresh(data.changed);
      const reply = String(data.reply ?? '');
      if (reply) history.current.push({ role: 'assistant', content: `[Approved] ${reply}` });
      if (data.actions?.some((a) => !a.ok)) push({ id: uid(), role: 'assistant', text: reply, tone: 'bad' });
      if (typeof data.navigate === 'string') navigate(`/g/${gym.slug}${data.navigate ? `/${data.navigate}` : ''}`);
    } catch (e) {
      // The request may not have reached the server; the same card can be retried
      // safely because each card carries its own idempotency key.
      update(turn.id, { decision: 'waiting' });
      fail(e);
    }
  }

  async function undo(turn: Turn, i: number) {
    const a = turn.actions?.[i]; const key = `${turn.id}:${i}`;
    if (!a?.undo || a.undone || undoBusy.current.has(key)) return;
    undoBusy.current.add(key);
    try {
      await rpc(a.undo.rpc, a.undo.args);
      update(turn.id, (x) => ({ actions: x.actions?.map((y, yi) => (yi === i ? { ...y, undone: true } : y)) }));
      refresh(['dashboard', 'payments', 'members', 'member', 'expenses', 'analytics', 'enquiries', 'daily-report']);
      history.current.push({ role: 'assistant', content: `[The user undid: ${a.summary}]` });
      toast(t.undone);
    } catch (e) { toast(errorMessage(e), 'bad'); }
    finally { undoBusy.current.delete(key); }
  }

  // ---------- microphone: tap to talk (auto-sends on silence) or hold to talk ----------
  async function startMic() {
    if (mic !== 'idle' || busy || closing.current) return;
    setMic('starting');
    try {
      const r = await startRecording({
        onAutoStop: () => { void finishMic(); },
        onLevel: (v) => { meter.current?.style.setProperty('--lvl', v.toFixed(3)); },
      });
      if (closing.current) { r.cancel(); return; }
      rec.current = r;
      setMic('recording');
    } catch (e) {
      setMic('idle');
      const reason = e instanceof MicError ? e.reason : 'unsupported';
      toast(reason === 'denied'
        ? (lang === 'ml' ? 'മൈക്ക് അനുമതി വേണം. Settings-ൽ Microphone ഓണാക്കൂ.' : 'Allow the microphone in your browser settings.')
        : reason === 'busy' ? (lang === 'ml' ? 'മൈക്ക് മറ്റൊരു ആപ്പ് ഉപയോഗിക്കുന്നു.' : 'The microphone is busy in another app.')
          : (lang === 'ml' ? 'ഈ ബ്രൗസറിൽ വോയ്സ് ഇല്ല. ടൈപ്പ് ചെയ്യൂ.' : 'Voice is not supported here. Please type.'), 'bad');
    }
  }
  async function finishMic() {
    const r = rec.current; if (!r) return;
    rec.current = null;
    setMic('idle');
    const clip = await r.stop();
    if (clip && !closing.current) void sendVoice(clip);
    else if (!closing.current) toast(lang === 'ml' ? 'ഒന്നും കേട്ടില്ല' : "Didn't hear anything");
  }
  function cancelMic() { rec.current?.cancel(); rec.current = null; setMic('idle'); }

  function micDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pressAt.current = Date.now();
    // The button is replaced while recording, so watch the release on the window.
    window.addEventListener('pointerup', micUp, { once: true });
    window.addEventListener('pointercancel', micUp, { once: true });
    if (mic === 'idle') void startMic();
    else if (mic === 'recording') void finishMic();
  }
  function micUp() {
    // Held for more than half a second: release sends (walkie-talkie style).
    if (rec.current && Date.now() - pressAt.current > 600) void finishMic();
  }

  function submit(e: FormEvent) { e.preventDefault(); void send(text); }
  function reset() {
    if (busy || mic !== 'idle') return;
    history.current = []; setTurns([]); setText('');
  }

  const voiceOk = canRecord();
  const recording = mic === 'recording';

  return (
    <Sheet instant title="XS AI" onClosing={() => { closing.current = true; cancelMic(); }} onClose={onClose}>
      <div className="xsai">
        <div className="xsai-top">
          {turns.length > 0 && (
            <button type="button" className="xsai-chip-btn" onClick={reset} disabled={busy || mic !== 'idle'} aria-label="New chat">
              <Plus size={16} /> {lang === 'ml' ? 'പുതിയ ചാറ്റ്' : 'New chat'}
            </button>
          )}
          <div className="xsai-lang" role="group" aria-label="Language">
            <button type="button" aria-pressed={lang === 'ml'} onClick={() => setLang('ml')}>മലയാളം</button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
          </div>
        </div>

        <div className="xsai-log" ref={log} aria-live="polite">
          {turns.length === 0 && (
            <div className="xsai-hello">
              <span className="xsai-orb" aria-hidden><Sparkles size={26} strokeWidth={1.6} /></span>
              <h3>{t.hello}</h3>
              <p>{t.sub}</p>
              <div className="xsai-chips">
                {CHIPS[lang].map((c) => <button type="button" key={c} onClick={() => void send(c)}>{c}</button>)}
              </div>
              <p className="xsai-try">{t.tryIt}</p>
            </div>
          )}

          {turns.map((turn) => (
            <div key={turn.id} className={`xsai-msg ${turn.role}${turn.tone ? ' bad' : ''}`}>
              {(turn.text || turn.listening) && (
                <div className={'xsai-bubble' + (turn.listening ? ' is-listening' : '')}>
                  {turn.voice && <Mic size={13} className="xsai-voice-tag" aria-label="Voice" />}
                  {turn.listening ? <span className="xsai-dots" aria-label={t.heard}><i /><i /><i /></span> : turn.text}
                </div>
              )}

              {turn.pending && (
                <div className={`xsai-approval is-${turn.decision}`}>
                  {turn.pending.map((p, i) => {
                    const Icon = ICONS[p.tool] ?? Sparkles;
                    const done = turn.actions?.[i];
                    return (
                      <div key={p.id} className={'xsai-card' + (p.danger ? ' danger' : '') + (done ? (done.ok ? (done.undone ? ' undone' : ' ok') : ' failed') : '')}>
                        <span className="xsai-card-icon" aria-hidden>{done?.ok && !done.undone ? <Check size={18} strokeWidth={2.6} /> : done && !done.ok ? <X size={18} strokeWidth={2.6} /> : <Icon size={18} />}</span>
                        <div className="xsai-card-body">
                          <strong>{lang === 'ml' ? p.titleMl : p.title}</strong>
                          {p.lines.map((line, li) => <span key={li} className={li === 0 ? 'lead' : ''}>{line}</span>)}
                          {done && !done.ok && <span className="err">{done.summary}</span>}
                        </div>
                        {done?.ok && done.undo && (
                          done.undone ? <span className="xsai-undone">{t.undone}</span>
                            : <button type="button" className="xsai-undo" onClick={() => void undo(turn, i)}><RotateCcw size={13} /> {t.undo}</button>
                        )}
                      </div>
                    );
                  })}
                  {turn.decision === 'waiting' && (
                    <div className="xsai-decide">
                      <button type="button" className="xsai-no" onClick={() => void decide(turn, false)}>{t.cancel}</button>
                      <button type="button" className="xsai-yes" onClick={() => void decide(turn, true)}>
                        <Check size={18} strokeWidth={2.6} /> {turn.pending.length > 1 ? `${t.approveAll} (${turn.pending.length})` : t.approve}
                      </button>
                    </div>
                  )}
                  {turn.decision === 'running' && <div className="xsai-status"><span className="xsai-spin" /> {t.running}</div>}
                  {turn.decision === 'cancelled' && <div className="xsai-status muted"><X size={14} /> {t.cancelled}</div>}
                </div>
              )}
            </div>
          ))}

          {busy && !turns.some((x) => x.listening) && turns.every((x) => x.decision !== 'running') && (
            <div className="xsai-msg assistant"><div className="xsai-bubble thinking"><span className="xsai-dots" aria-label={t.thinking}><i /><i /><i /></span></div></div>
          )}
        </div>

        {recording || mic === 'starting' ? (
          <div className="xsai-recbar" ref={meter} role="status">
            <button type="button" className="xsai-rec-cancel" onClick={cancelMic} aria-label="Cancel recording"><X size={20} /></button>
            <div className="xsai-rec-mid">
              <div className="xsai-wave" aria-hidden><i /><i /><i /><i /><i /><i /><i /></div>
              <span>{mic === 'starting' ? '…' : `${t.listening} · 0:${String(Math.min(seconds, Math.round(MAX_MS / 1000))).padStart(2, '0')}`}</span>
            </div>
            <button type="button" className="xsai-rec-send" aria-label="Send voice"
              onPointerDown={micDown} onClick={(e) => { if (e.detail === 0) void finishMic(); }}>
              <ArrowUp size={22} strokeWidth={2.6} />
            </button>
          </div>
        ) : (
          <form className="xsai-composer" onSubmit={submit}>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.placeholder}
              lang={lang === 'ml' ? 'ml' : 'en'} enterKeyHint="send" aria-label="Message XS AI" />
            {text.trim() ? (
              <button type="submit" className="xsai-send" disabled={busy} aria-label="Send"><ArrowUp size={22} strokeWidth={2.6} /></button>
            ) : voiceOk ? (
              <button type="button" className="xsai-mic" disabled={busy} aria-label="Talk to XS AI"
                onPointerDown={micDown} onContextMenu={(e) => e.preventDefault()}
                onClick={(e) => { if (e.detail === 0) void startMic(); }}>
                <Mic size={22} strokeWidth={2.2} />
              </button>
            ) : null}
          </form>
        )}
      </div>
    </Sheet>
  );
}
