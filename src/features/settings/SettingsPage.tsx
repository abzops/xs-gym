import { staffQuery } from '../../lib/sections';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, MessageCircle, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useGym } from '../../app/gym';
import { AppearanceControl } from '../../components/Appearance';
import { waLink } from '../../components/WhatsApp';
import { Field, Loading, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { credentialsText, loginUrl, ROLE_ACCESS, type CredentialLang, type Credentials } from '../../lib/staffLogin';
import { createStaffLogin, removeStaffLogin, resetStaffPassword } from '../../lib/staffLoginApi';
import { rpc } from '../../lib/supabase';
import { ROLE_LABEL, type Role, type StaffRow } from '../../lib/types';

export function SettingsPage() {
  const { can, subscription } = useGym();
  return (
    <div className="stack lg" style={{ maxWidth: 820 }}>
      <div className="page-head"><h1>Settings</h1></div>
      <section className="card appearance-row">
        <h2>Appearance</h2>
        <AppearanceControl />
      </section>
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
  const [open, setOpen] = useState<StaffRow | 'new' | null>(null);
  const [shown, setShown] = useState<{ creds: Credentials; reset: boolean } | null>(null);
  const staff = useQuery(staffQuery(gym.id));
  const manage = can('staff.manage');
  return (
    <section className="card flush">
      <div className="card-head" style={{ padding: '16px 16px 0' }}>
        <h2>Staff</h2>
        {manage && <button className="btn small" onClick={() => setOpen('new')}><UserPlus size={16} /> Add staff</button>}
      </div>
      {staff.isPending ? <div style={{ padding: 16 }}><Loading rows={2} /></div> : staff.error ? <Notice tone="bad">{errorMessage(staff.error)}</Notice> : (
        <ul className="list">
          {staff.data.map((s) => (
            <li key={s.id}>
              <button className="item" disabled={!manage || s.role === 'owner'} onClick={() => setOpen(s)}>
                <span className="main-col">
                  <span className="title">{s.display_name ?? s.username ?? s.email}</span>
                  <span className="meta">{s.username ? `Username ${s.username}${s.phone ? ` · ${s.phone}` : ''}` : s.email}</span>
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
      {manage && <p className="muted" style={{ padding: '0 18px 18px' }}>Add staff with their name and WhatsApp number. XS Gym makes a username and password you can send them on WhatsApp.</p>}
      {open === 'new' && <AddStaffSheet onClose={() => setOpen(null)} onCreated={(creds) => { setOpen(null); setShown({ creds, reset: false }); }} />}
      {open && open !== 'new' && <EditStaffSheet staff={open} onClose={() => setOpen(null)} onReset={(creds) => { setOpen(null); setShown({ creds, reset: true }); }} />}
      {shown && <CredentialsSheet creds={shown.creds} reset={shown.reset} onClose={() => setShown(null)} />}
    </section>
  );
}

type StaffRole = Exclude<Role, 'owner'>;

function RolePicker({ value, onChange }: { value: StaffRole; onChange: (r: StaffRole) => void }) {
  return (
    <Field label="Access" hint={ROLE_ACCESS[value]}>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as StaffRole)}>
        <option value="reception">Reception</option>
        <option value="trainer">Trainer</option>
        <option value="manager">Manager</option>
      </select>
    </Field>
  );
}

function AddStaffSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Credentials) => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const [byEmail, setByEmail] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('reception');
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => createStaffLogin(gym.id, name.trim(), phone.trim(), role),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['staff', gym.id] });
      onCreated({ username: r.username, password: r.password, name: r.staff.display_name ?? name.trim(), phone: r.staff.phone ?? null, role });
    },
  });
  const addByEmail = useMutation({
    mutationFn: () => rpc('save_staff', { p_gym: gym.id, p_email: email, p_role: role, p_status: 'active' }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['staff', gym.id] }); toast('Staff added'); onClose(); },
  });
  const digits = phone.replace(/\D/g, '');
  const ready = byEmail ? !!email.trim() : name.trim().length >= 2 && digits.length >= 10;
  const pending = create.isPending || addByEmail.isPending;
  const err = create.error ?? addByEmail.error;
  return (
    <Sheet title="Add staff" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (ready && !pending) (byEmail ? addByEmail : create).mutate(); }}>
        {byEmail ? (
          <Field label="Email they signed up with">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
        ) : (
          <>
            <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
            <Field label="WhatsApp number" hint="The login is sent to this number.">
              <input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
            </Field>
          </>
        )}
        <RolePicker value={role} onChange={setRole} />
        {err && <Notice tone="bad">{errorMessage(err)}</Notice>}
        <button className="btn primary block" disabled={!ready || pending}>
          {pending ? <span className="spinner" /> : byEmail ? 'Add staff' : <><KeyRound size={16} aria-hidden /> Create login</>}
        </button>
        <button type="button" className="text-link" onClick={() => { setByEmail((v) => !v); create.reset(); addByEmail.reset(); }}>
          {byEmail ? 'Make a username and password instead' : 'Already has an XS Gym account? Add by email'}
        </button>
      </form>
    </Sheet>
  );
}

function EditStaffSheet({ staff, onClose, onReset }: { staff: StaffRow; onClose: () => void; onReset: (c: Credentials) => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(staff.display_name ?? '');
  const [phone, setPhone] = useState(staff.phone ?? '');
  const [role, setRole] = useState<StaffRole>(staff.role as StaffRole);
  const [active, setActive] = useState(staff.status === 'active');
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const remove = useMutation({
    mutationFn: () => staff.username ? removeStaffLogin(gym.id, staff.id) : rpc('remove_staff', { p_gym: gym.id, p_staff: staff.id }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['staff', gym.id] }); toast(`${staff.display_name ?? 'Staff member'} removed`); onClose(); },
  });
  const save = useMutation({
    mutationFn: () => rpc('update_staff', { p_gym: gym.id, p_staff: staff.id, p_name: name, p_phone: phone || null, p_role: role, p_status: active ? 'active' : 'inactive' }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['staff', gym.id] }); toast('Staff saved'); onClose(); },
  });
  const reset = useMutation({
    mutationFn: () => resetStaffPassword(gym.id, staff.id),
    onSuccess: (c) => onReset(c),
  });
  return (
    <Sheet title="Edit staff" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) save.mutate(); }}>
        <p className="muted" style={{ margin: 0 }}>{staff.username ? <>Signs in with username <strong>{staff.username}</strong></> : <>Signs in with {staff.email}</>}</p>
        <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="WhatsApp number"><input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <RolePicker value={role} onChange={setRole} />
        <label className="row" style={{ gap: 10 }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Has access</label>
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn primary block" disabled={name.trim().length < 2 || save.isPending}>Save</button>
        {staff.username && (
          <div className="stack">
            {confirmReset ? (
              <Notice tone="warn">
                <span className="stack">
                  <span>The old password stops working right away. You'll get a new one to send on WhatsApp.</span>
                  <span className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn small" onClick={() => setConfirmReset(false)}>Cancel</button>
                    <button type="button" className="btn small primary" disabled={reset.isPending} onClick={() => reset.mutate()}>
                      {reset.isPending ? <span className="spinner" /> : 'Reset password'}
                    </button>
                  </span>
                </span>
              </Notice>
            ) : (
              <button type="button" className="btn block" onClick={() => setConfirmReset(true)}><KeyRound size={16} aria-hidden /> Reset password</button>
            )}
            {reset.error && <Notice tone="bad">{errorMessage(reset.error)}</Notice>}
          </div>
        )}
        {confirmRemove ? (
          <Notice tone="bad">
            <span className="stack">
              <span>{staff.username
                ? 'Remove from the gym and delete this login? They can no longer sign in. Their past work stays in the records.'
                : 'Remove from the gym? They lose access to this gym. Their own XS Gym account is not deleted.'}</span>
              <span className="row" style={{ gap: 8 }}>
                <button type="button" className="btn small" onClick={() => setConfirmRemove(false)}>Cancel</button>
                <button type="button" className="btn small danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  {remove.isPending ? <span className="spinner" /> : 'Remove staff'}
                </button>
              </span>
            </span>
          </Notice>
        ) : (
          <button type="button" className="btn block danger" onClick={() => setConfirmRemove(true)}><Trash2 size={16} aria-hidden /> Remove from gym</button>
        )}
        {remove.error && <Notice tone="bad">{errorMessage(remove.error)}</Notice>}
      </form>
    </Sheet>
  );
}

const CRED_LANG_KEY = 'xs-wa-lang';

/** Shown once after a login is made or reset: the details plus a ready WhatsApp message. */
function CredentialsSheet({ creds, reset, onClose }: { creds: Credentials; reset: boolean; onClose: () => void }) {
  const { gym } = useGym();
  const toast = useToast();
  const [lang, setLangState] = useState<CredentialLang>(() => { try { return localStorage.getItem(CRED_LANG_KEY) === 'ml' ? 'ml' : 'en'; } catch { return 'en'; } });
  const setLang = (l: CredentialLang) => { setLangState(l); try { localStorage.setItem(CRED_LANG_KEY, l); } catch { /* private mode */ } };
  const text = credentialsText(lang, creds, gym.name, loginUrl(creds.username), reset);
  const copy = async (value: string, what: string) => {
    try { await navigator.clipboard.writeText(value); toast(`${what} copied`); } catch { toast('Copy failed — select the text instead'); }
  };
  return (
    <Sheet title={reset ? 'New password' : 'Login created'} onClose={onClose}>
      <div className="stack lg">
        <p className="muted" style={{ margin: 0 }}>For <strong>{creds.name}</strong> · {ROLE_LABEL[creds.role]}</p>
        <dl className="kv cred">
          <dt>Username</dt><dd className="mono"><strong>{creds.username}</strong></dd>
          <dt>Password</dt><dd className="mono"><strong data-testid="staff-password">{creds.password}</strong></dd>
        </dl>
        <Notice tone="warn">This password is shown only now. If it's lost, use Reset password.</Notice>
        <Segmented label="Message language" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'ml', label: 'മലയാളം' }]} />
        <pre className="cred-message">{text}</pre>
        {creds.phone ? (
          <a className="btn primary block xl wa" href={waLink(creds.phone, text)} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={18} aria-hidden /> Send on WhatsApp to {creds.phone}
          </a>
        ) : <Notice>Add a WhatsApp number to this staff member to send it directly.</Notice>}
        <button type="button" className="btn block" onClick={() => copy(text, 'Message')}><Copy size={16} aria-hidden /> Copy message</button>
        <button type="button" className="text-link" onClick={onClose}>Done</button>
      </div>
    </Sheet>
  );
}
