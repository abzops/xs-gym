import { staffQuery } from '../../lib/sections';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useGym } from '../../app/gym';
import { AppearanceControl } from '../../components/Appearance';
import { Field, Loading, Notice, Sheet, useToast } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { rpc } from '../../lib/supabase';
import { ROLE_LABEL, type Role, type StaffRow } from '../../lib/types';
import { setSpokenReplies, spokenRepliesEnabled } from '../ai/preferences';

import { sarvamReadiness, type SarvamReadiness } from '../ai/sarvamStatus';

export function SettingsPage() {
  const { can, subscription } = useGym();
  return (
    <div className="stack lg" style={{ maxWidth: 820 }}>
      <div className="page-head"><h1>Settings</h1></div>
      <section className="card appearance-row">
        <h2>Appearance</h2>
        <AppearanceControl />
      </section>
      <SpokenRepliesSetting />
      {can('gym.settings') && <GymSettings />}
      <StaffSection />
      <section className="card stack">
        <h2>Subscription</h2>
        {subscription ? (
          <dl className="kv">
            <dt>Plan</dt><dd>XS Gym {subscription.plan.toUpperCase()}{subscription.status === 'trial' ? ' (trial)' : ''}</dd>
            {subscription.trial_ends_at && <><dt>Trial ends</dt><dd>{formatDate(subscription.trial_ends_at.slice(0, 10))}</dd></>}
            {subscription.paid_until && <><dt>Paid until</dt><dd>{formatDate(subscription.paid_until.slice(0, 10))}</dd></>}
          </dl>
        ) : <p className="muted">No subscription found.</p>}
      </section>
    </div>
  );
}

function SpokenRepliesSetting() {
  const [enabled, setEnabled] = useState(spokenRepliesEnabled);
  const [speechReady, setSpeechReady] = useState<SarvamReadiness | null>(null);
  useEffect(() => {
    let active = true;
    void sarvamReadiness().then((value) => { if (active) setSpeechReady(value); });
    return () => { active = false; };
  }, []);
  return (
    <section className="card" aria-label="XS AI settings">
      <div className="row between" style={{ alignItems: 'center', gap: 16 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h2>XS AI</h2>
          <label htmlFor="xs-ai-spoken-replies">Spoken replies</label>
          <span className="muted" style={{ fontSize: 13 }}>Off by default · this device only</span>
        </div>
        <input id="xs-ai-spoken-replies" type="checkbox" role="switch"
          checked={enabled} aria-label="XS AI spoken replies"
          onChange={(event) => {
            const next = event.target.checked;
            setSpokenReplies(next);
            setEnabled(next);
          }} />
      </div>
      <div className="stack" style={{ gap: 5, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--hair)' }}>
        <strong style={{ fontSize: 14 }}>Malayalam voice</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          Works automatically when you hold the microphone. On iPhones, Sarvam AI
          transcribes Malayalam securely; on other browsers it is used when
          built-in recognition fails. Audio is captured only during your hold,
          never in the background. No additional setting is needed.
        </span>
        <span className="muted" role="status" style={{ fontSize: 12 }}>
          {!speechReady ? 'Checking speech service…' : speechReady.ready
            ? 'Malayalam speech service ready.'
            : 'Malayalam voice service unavailable. Contact your administrator.'}
        </span>
      </div>
    </section>
  );
}

function GymSettings() {
  const { gym } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(gym.name);
  const [phone, setPhone] = useState(gym.phone ?? '');
  const [address, setAddress] = useState(gym.address ?? '');
  const [grace, setGrace] = useState(String(gym.grace_days));
  const g = Number(grace);
  const valid = name.trim().length >= 2 && Number.isInteger(g) && g >= 0 && g <= 60;
  const save = useMutation({
    mutationFn: () => rpc('update_gym_settings', { p_gym: gym.id, p_name: name, p_phone: phone, p_address: address, p_grace_days: g }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['gym'] }); toast('Settings saved'); },
  });
  return (
    <form className="card stack lg" onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(); }}>
      <h2>Gym details</h2>
      <div className="grid-2">
        <Field label="Gym name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone"><input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <Field label="Address"><textarea className="input" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <Field label="Grace days after expiry">
        <input className="input" inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 140 }} />
      </Field>
      {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
      <div className="row end"><button className="btn primary" disabled={!valid || save.isPending}>Save</button></div>
    </form>
  );
}

function StaffSection() {
  const { gym, can } = useGym();
  const [adding, setAdding] = useState<StaffRow | 'new' | null>(null);
  const staff = useQuery(staffQuery(gym.id));
  const manage = can('staff.manage');
  return (
    <section className="card flush">
      <div className="card-head" style={{ padding: '16px 16px 0' }}>
        <h2>Staff</h2>
        {manage && <button className="btn small" onClick={() => setAdding('new')}><UserPlus size={16} /> Add staff</button>}
      </div>
      {staff.isPending ? <div style={{ padding: 16 }}><Loading rows={2} /></div> : staff.error ? <Notice tone="bad">{errorMessage(staff.error)}</Notice> : (
        <ul className="list">
          {staff.data.map((s) => (
            <li key={s.id}>
              <button className="item" disabled={!manage || s.role === 'owner'} onClick={() => setAdding(s)}>
                <span className="main-col">
                  <span className="title">{s.display_name ?? s.email}</span>
                  <span className="meta">{s.email}</span>
                </span>
                <span className="end-col">
                  <span className="badge neutral">{ROLE_LABEL[s.role]}</span>
                  {s.status === 'inactive' && <span className="badge bad">No access</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {manage && <p className="muted" style={{ padding: '0 18px 18px' }}>Staff sign up first; then add them by email.</p>}
      {adding && <StaffSheet staff={adding === 'new' ? null : adding} onClose={() => setAdding(null)} />}
    </section>
  );
}

function StaffSheet({ staff, onClose }: { staff: StaffRow | null; onClose: () => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState(staff?.email ?? '');
  const [role, setRole] = useState<Exclude<Role, 'owner'>>((staff?.role as Exclude<Role, 'owner'>) ?? 'reception');
  const [active, setActive] = useState(staff ? staff.status === 'active' : true);
  const save = useMutation({
    mutationFn: () => rpc('save_staff', { p_gym: gym.id, p_email: email, p_role: role, p_status: active ? 'active' : 'inactive' }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['staff', gym.id] }); toast('Staff saved'); onClose(); },
  });
  return (
    <Sheet title={staff ? 'Edit staff access' : 'Add staff'} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (email.trim()) save.mutate(); }}>
        <Field label="Email they signed up with">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!staff} />
        </Field>
        <Field label="Role">
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Exclude<Role, 'owner'>)}>
            <option value="reception">Reception</option>
            <option value="manager">Manager</option>
            <option value="trainer">Trainer</option>
          </select>
        </Field>
        {staff && <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Has access</label>}
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn primary block" disabled={!email.trim() || save.isPending}>Save</button>
      </form>
    </Sheet>
  );
}
