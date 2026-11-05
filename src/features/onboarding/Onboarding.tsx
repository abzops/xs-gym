// First-run setup after signup: gym details → plans → first member → team →
// done. Every step can be skipped; finishing (or skipping all) marks the gym
// as onboarded so this never shows again.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ClipboardList, Download, Sparkles, Store, UserPlus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Field, Logo, Notice, Segmented, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { parseINR } from '../../lib/money';
import { rpc, supabase } from '../../lib/supabase';
import type { Role } from '../../lib/types';
import './onboarding.css';

type Step = 'gym' | 'plans' | 'member' | 'team' | 'done';
const STEPS: { id: Step; label: string; icon: typeof Store }[] = [
  { id: 'gym', label: 'Gym', icon: Store }, { id: 'plans', label: 'Plans', icon: ClipboardList },
  { id: 'member', label: 'Member', icon: UserPlus }, { id: 'team', label: 'Team', icon: Users }, { id: 'done', label: 'Done', icon: Check },
];

type Preset = { name: string; unit: 'day' | 'month'; count: number; price: string; on: boolean };
const PRESETS: Preset[] = [
  { name: 'Monthly', unit: 'month', count: 1, price: '1200', on: true },
  { name: 'Quarterly', unit: 'month', count: 3, price: '3300', on: true },
  { name: 'Half-yearly', unit: 'month', count: 6, price: '6000', on: true },
  { name: 'Yearly', unit: 'month', count: 12, price: '10800', on: true },
  { name: 'Day pass', unit: 'day', count: 1, price: '150', on: false },
  { name: 'Personal training', unit: 'month', count: 1, price: '4000', on: false },
];

export function Onboarding() {
  const { gym } = useGym();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('gym');
  const [made, setMade] = useState({ plans: 0, member: '' as string, team: 0 });
  const i = STEPS.findIndex((s) => s.id === step);
  const next = () => setStep(STEPS[Math.min(i + 1, STEPS.length - 1)].id);
  const back = () => setStep(STEPS[Math.max(i - 1, 0)].id);
  const finish = useMutation({
    mutationFn: () => rpc('complete_onboarding', { p_gym: gym.id }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['gym'] }); },
  });
  const leave = async (to = '') => {
    if (!finish.isSuccess) await finish.mutateAsync().catch(() => {});
    navigate(`/g/${gym.slug}${to}`, { replace: true });
  };

  return (
    <div className="onb">
      <header className="onb-top">
        {i > 0 && step !== 'done' ? <button type="button" className="onb-back" onClick={back}><ChevronLeft size={20} /> Back</button> : <span />}
        <Logo width={84} />
        {step !== 'done' ? <button type="button" className="onb-skip" onClick={() => leave()}>Skip setup</button> : <span />}
      </header>
      <ol className="onb-steps" aria-label="Setup steps">
        {STEPS.map((s, k) => (
          <li key={s.id} className={k < i ? 'past' : k === i ? 'now' : ''} aria-current={k === i ? 'step' : undefined}>
            <span className="dot">{k < i ? <Check size={14} strokeWidth={3} /> : k + 1}</span><span className="lbl">{s.label}</span>
          </li>
        ))}
      </ol>
      <main className="onb-body" key={step}>
        {step === 'gym' && <GymStep onNext={next} />}
        {step === 'plans' && <PlansStep onNext={(n) => { setMade((m) => ({ ...m, plans: n })); next(); }} />}
        {step === 'member' && <MemberStep onNext={(name) => { setMade((m) => ({ ...m, member: name })); next(); }} />}
        {step === 'team' && <TeamStep onNext={(n) => { setMade((m) => ({ ...m, team: n })); finish.mutate(); next(); }} />}
        {step === 'done' && <DoneStep made={made} onGo={leave} />}
      </main>
    </div>
  );
}

function Head({ title, sub }: { title: string; sub: ReactNode }) {
  return <div className="onb-head"><h1>{title}</h1><p className="muted">{sub}</p></div>;
}

function GymStep({ onNext }: { onNext: () => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const [name, setName] = useState(gym.name);
  const [phone, setPhone] = useState(gym.phone ?? '');
  const [address, setAddress] = useState(gym.address ?? '');
  const [grace, setGrace] = useState(String(gym.grace_days));
  const save = useMutation({
    mutationFn: () => rpc('update_gym_settings', { p_gym: gym.id, p_name: name, p_phone: phone, p_address: address, p_grace_days: Number(grace) }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['gym'] }); onNext(); },
  });
  return (
    <form className="stack lg" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Head title="Welcome to XS Gym" sub="Let's set up your gym in about two minutes. You can change any of this later in Settings." />
      <div className="card stack lg">
        <Field label="Gym name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Gym phone" hint="Shown on receipts and reminders"><input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Address" hint="Printed on receipts"><textarea className="input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Optional" /></Field>
        <div className="field"><span>Grace days after a plan ends</span>
          <Segmented label="Grace days" value={grace} onChange={setGrace} options={['0', '3', '5', '7'].map((v) => ({ value: v, label: v === '0' ? 'None' : `${v} days` }))} />
          <span className="hint">Members stay active this many days after expiry before they count as lapsed</span>
        </div>
      </div>
      {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
      <button className="btn primary block xl" disabled={save.isPending || name.trim().length < 2}>{save.isPending ? <span className="spinner" /> : 'Continue'}</button>
    </form>
  );
}

function PlansStep({ onNext }: { onNext: (n: number) => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: ['plans', gym.id, 'onboarding'],
    queryFn: async () => {
      const { data, error } = await supabase.from('membership_plans').select('name').eq('gym_id', gym.id).eq('status', 'active');
      if (error) throw error;
      return new Set(data.map((p) => (p.name as string).toLowerCase()));
    },
  });
  const [plans, setPlans] = useState(PRESETS);
  const set = (k: number, patch: Partial<Preset>) => setPlans((ps) => ps.map((p, j) => (j === k ? { ...p, ...patch } : p)));
  const chosen = plans.filter((p) => p.on && !existing.data?.has(p.name.toLowerCase()));
  const bad = chosen.some((p) => parseINR(p.price) === null);
  const save = useMutation({
    mutationFn: async () => {
      for (const p of chosen) {
        await rpc('save_plan', { p_gym: gym.id, p_plan: null, p_name: p.name, p_duration_unit: p.unit, p_duration_count: p.count, p_price_paise: parseINR(p.price) });
      }
      return chosen.length;
    },
    onSuccess: async (n) => { await qc.invalidateQueries({ queryKey: ['plans', gym.id] }); onNext(n); },
  });
  return (
    <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (!bad) save.mutate(); }}>
      <Head title="What do you sell?" sub="Pick your plans and set your prices. These are common in Kerala gyms; edit freely." />
      <ul className="onb-plans">
        {plans.map((p, k) => {
          const have = existing.data?.has(p.name.toLowerCase());
          return (
            <li key={p.name} className={p.on || have ? 'on' : ''}>
              <label className="onb-check">
                <input type="checkbox" checked={p.on || !!have} disabled={have} onChange={(e) => set(k, { on: e.target.checked })} />
                <span><b>{p.name}</b><small className="muted">{have ? 'Already added' : `${p.count} ${p.unit}${p.count > 1 ? 's' : ''}`}</small></span>
              </label>
              <span className="onb-price">
                <span aria-hidden>₹</span>
                <input className="input num" inputMode="decimal" aria-label={`${p.name} price`} value={p.price} disabled={!p.on || have}
                  onChange={(e) => set(k, { price: e.target.value })} />
              </span>
            </li>
          );
        })}
      </ul>
      {bad && <Notice tone="warn">Enter a price like 1200 for each plan you picked.</Notice>}
      {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
      <button className="btn primary block xl" disabled={save.isPending || bad}>
        {save.isPending ? <span className="spinner" /> : chosen.length ? `Add ${chosen.length} plan${chosen.length > 1 ? 's' : ''}` : 'Continue'}
      </button>
    </form>
  );
}

function MemberStep({ onNext }: { onNext: (name: string) => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other' | ''>('');
  const save = useMutation({
    mutationFn: () => rpc('create_member', { p_gym: gym.id, p_full_name: name, p_phone: phone, p_gender: gender || null }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['members', gym.id] }); onNext(name); },
  });
  const ready = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10;
  return (
    <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
      <Head title="Add your first member" sub={<>Have a list already? You can <b>import a CSV</b> from Members after setup.</>} />
      <div className="card stack lg">
        <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
        <Field label="Mobile"><input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 digits" /></Field>
        <div className="field"><span>Gender</span>
          <Segmented label="Gender" value={gender || 'none'} onChange={(v) => setGender(v === 'none' ? '' : v)}
            options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }, { value: 'other', label: 'Other' }, { value: 'none', label: 'Skip' }]} />
        </div>
      </div>
      {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
      <button className="btn primary block xl" disabled={save.isPending || !ready}>{save.isPending ? <span className="spinner" /> : 'Add member'}</button>
      <button type="button" className="btn ghost block" onClick={() => onNext('')}>Skip for now</button>
    </form>
  );
}

function TeamStep({ onNext }: { onNext: (n: number) => void }) {
  const { gym } = useGym();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('reception');
  const [added, setAdded] = useState(0);
  const save = useMutation({
    mutationFn: () => rpc('save_staff', { p_gym: gym.id, p_email: email, p_role: role, p_status: 'active' }),
    onSuccess: () => { setAdded((n) => n + 1); toast(`${email} added`); setEmail(''); },
  });
  return (
    <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (email.includes('@')) save.mutate(); }}>
      <Head title="Bring your team" sub="Staff sign up with their own email first, then you add them here. Each role sees only what it needs." />
      <div className="card stack lg">
        <Field label="Staff email"><input className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
        <div className="field"><span>Role</span>
          <Segmented label="Role" value={role} onChange={setRole}
            options={[{ value: 'manager', label: 'Manager' }, { value: 'reception', label: 'Front desk' }, { value: 'trainer', label: 'Trainer' }]} />
        </div>
        <p className="muted onb-roles">{role === 'manager' ? 'Everything except billing and staff changes.' : role === 'reception' ? 'Members, plans, payments and the dashboard. No money reports.' : 'Looks up members and plans only.'}</p>
        <button className="btn" disabled={save.isPending || !email.includes('@')}>{save.isPending ? <span className="spinner" /> : 'Add to team'}</button>
        {added > 0 && <Notice tone="ok">{added} added. Add another or continue.</Notice>}
      </div>
      {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
      <button type="button" className="btn primary block xl" onClick={() => onNext(added)}>{added ? 'Continue' : 'Skip for now'}</button>
    </form>
  );
}

function DoneStep({ made, onGo }: { made: { plans: number; member: string; team: number }; onGo: (to?: string) => void }) {
  const lines: [boolean, string][] = [
    [!!made.plans, made.plans ? `${made.plans} plan${made.plans > 1 ? 's' : ''} ready to sell` : 'Plans: add them any time from Plans'],
    [!!made.member, made.member ? `${made.member} is your first member` : 'Members: add or import from Members'],
    [!!made.team, made.team ? `${made.team} staff added` : 'Team: add staff from Settings'],
  ];
  return (
    <div className="stack lg">
      <div className="onb-done-mark" aria-hidden><Check size={40} strokeWidth={2.5} /></div>
      <Head title="You're all set" sub={`Your 30-day free trial is running. Here is what's ready:`} />
      <ul className="card onb-summary">{lines.map(([ok, l]) => <li key={l} className={ok ? '' : 'todo'}>{ok ? <Check size={16} aria-hidden /> : <span className="todo-dot" aria-hidden />} {l}</li>)}</ul>
      <div className="onb-tips">
        <div><Sparkles size={18} aria-hidden /><span><b>Ask XS AI</b> — “Renew Anjali on Monthly” or “Who has dues?” in English or Malayalam.</span></div>
        <div><Download size={18} aria-hidden /><span><b>Install the app</b> — in Safari tap Share → Add to Home Screen; in Chrome tap Install.</span></div>
      </div>
      <button type="button" className="btn primary block xl" onClick={() => onGo()}>Go to dashboard</button>
      {made.member && <button type="button" className="btn ghost block" onClick={() => onGo('/members')}>Sell {made.member.split(' ')[0]} a plan</button>}
      {!made.member && <Link className="btn ghost block" to="#" onClick={(e) => { e.preventDefault(); onGo('/members/import'); }}>Import members from CSV</Link>}
    </div>
  );
}

