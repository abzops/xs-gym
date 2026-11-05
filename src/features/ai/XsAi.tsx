import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Check, Mic, RotateCcw, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import { canListen, listen, speak, stopSpeaking, voiceFor, type Lang } from './voice';
import './ai.css';

type Action = { tool: string; ok: boolean; summary: string; undo?: { rpc: string; args: Record<string, unknown> }; undone?: boolean };
type Turn = { role: 'user' | 'assistant'; content: string; actions?: Action[]; tone?: 'bad' };
type State = 'idle' | 'listening' | 'thinking' | 'speaking';

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
  const stopRef = useRef<() => void>(() => {});
  const scroller = useRef<HTMLDivElement>(null);
  const turnsRef = useRef(turns); turnsRef.current = turns;
  const voiceOk = canListen();

  useEffect(() => { try { localStorage.setItem(LANG_KEY, lang); } catch { /* storage blocked */ } }, [lang]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [turns, live, state]);
  useEffect(() => () => { stopRef.current(); stopSpeaking(); }, []);

  async function ask(content: string) {
    const q = content.trim();
    if (!q || state === 'thinking') return;
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
      const reply = String(data.reply ?? '');
      setTurns((t) => [...t, { role: 'assistant', content: reply, actions: data.actions }]);
      for (const key of data.changed ?? []) void qc.invalidateQueries({ queryKey: [key, gym.id] });
      if (typeof data.navigate === 'string') navigate(`/g/${gym.slug}${data.navigate ? `/${data.navigate}` : ''}`);
      if (!mute && reply) {
        setState('speaking');
        await speak(reply, lang); // no Malayalam voice → the status line says replies are text
      }
    } catch (e) {
      setTurns((t) => [...t, { role: 'assistant', content: e instanceof Error ? e.message : String(e), tone: 'bad' }]);
    } finally {
      setState('idle');
    }
  }

  async function talk() {
    if (state === 'listening') { stopRef.current(); return; }
    stopSpeaking();
    setState('listening'); setLive('');
    try {
      const l = listen(lang, setLive);
      stopRef.current = l.stop;
      const heard = await l.done;
      setState('idle');
      if (heard) await ask(heard);
    } catch (e) {
      setState('idle');
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  }

  async function undo(turn: number, i: number) {
    const a = turns[turn].actions?.[i];
    if (!a?.undo || a.undone) return;
    try {
      await rpc(a.undo.rpc, a.undo.args);
      setTurns((ts) => ts.map((t, ti) => ti !== turn ? t : { ...t, actions: t.actions?.map((x, xi) => xi === i ? { ...x, undone: true } : x) }));
      await Promise.all(['dashboard', 'payments', 'members', 'member', 'expenses', 'checkins'].map((k) => qc.invalidateQueries({ queryKey: [k, gym.id] })));
      toast('Undone');
    } catch (e) { toast(errorMessage(e), 'bad'); }
  }

  const status = state === 'listening' ? (lang === 'ml' ? 'കേൾക്കുന്നു…' : 'Listening…')
    : state === 'thinking' ? (lang === 'ml' ? 'ആലോചിക്കുന്നു…' : 'Thinking…')
    : state === 'speaking' ? '' : voiceOk ? (lang === 'ml' ? 'സംസാരിക്കാൻ ടാപ്പ് ചെയ്യൂ' : 'Tap to talk') : 'Type below';

  return (
    <Sheet title="XS AI" onClose={() => { stopRef.current(); stopSpeaking(); onClose(); }}>
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
              aria-label={state === 'listening' ? 'Stop listening' : 'Talk to XS AI'}>
              <span className="xsai-orb-glow" aria-hidden />
              {state === 'listening' ? <Square size={22} fill="currentColor" /> : <Mic size={26} />}
            </button>
          )}
          <p className="xsai-status" aria-live="polite">{status}{lang === 'ml' && !mute && !voiceFor('ml') ? ' · replies shown as text on this device' : ''}</p>
          <form className="xsai-type" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={lang === 'ml' ? 'ടൈപ്പ് ചെയ്യൂ…' : 'Type a message…'} aria-label="Message XS AI" enterKeyHint="send" />
            <button className="btn primary icon-btn" disabled={!text.trim() || state === 'thinking'} aria-label="Send"><ArrowUp size={20} /></button>
          </form>
        </div>
      </div>
    </Sheet>
  );
}
