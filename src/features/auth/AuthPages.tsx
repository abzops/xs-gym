import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { Field, Logo, Notice, Segmented, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import type { Gym } from '../../lib/types';

const appUrl = () => new URL(import.meta.env.BASE_URL, window.location.origin).toString();

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-split">
      <aside className="auth-brand">
        <Logo onDark />
        <div className="stack lg">
          <h1>Run your gym simply. Know your numbers accurately.</h1>
          <p>Members, renewals, check-ins and collections for your front desk, on any phone, tablet or laptop.</p>
        </div>
        <ul className="points">
          <li><strong>Check in at the desk in seconds</strong>Search by name, phone or member number.</li>
          <li><strong>Every rupee accounted for</strong>Payments, dues and reversals reconcile to the paisa.</li>
          <li><strong>Each person signs in as themselves</strong>Roles decide who can discount, reverse or export.</li>
        </ul>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}

export function LoginPage() {
  const { session } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Password should be at least 8 characters');
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: appUrl() },
        });
        if (error) throw error;
        if (!data.session) setSent(`We sent a confirmation link to ${email.trim()}. Open it, then come back here and sign in.`);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
        if (error) throw error;
        setSent(`If ${email.trim()} has an account, a reset link is on its way.`);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'signin' ? 'Sign in to XS Gym' : mode === 'signup' ? 'Create your account' : 'Reset your password';

  return (
    <AuthLayout>
      <div className="auth">
        <div className="stack">
          <h2>{title}</h2>
          <p className="muted">
            {mode === 'signin' && 'Use the email and password you registered with.'}
            {mode === 'signup' && 'Owners create the gym after signing up. Staff sign up, then the owner adds them.'}
            {mode === 'reset' && 'Enter your email and we will send a link to set a new password.'}
          </p>
        </div>
        {mode !== 'reset' && (
          <Segmented
            label="Account"
            value={mode}
            onChange={(v) => { setMode(v); setError(null); setSent(null); }}
            options={[{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Create account' }]}
          />
        )}
        {sent ? (
          <Notice tone="ok">{sent}</Notice>
        ) : (
          <form className="stack lg" onSubmit={submit} noValidate>
            {mode === 'signup' && (
              <Field label="Your name">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
              </Field>
            )}
            <Field label="Email">
              <input className="input" type="email" inputMode="email" autoComplete="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            {mode !== 'reset' && (
              <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required />
              </Field>
            )}
            {error && <Notice tone="bad">{error}</Notice>}
            <button className="btn primary block" disabled={busy || !email || (mode !== 'reset' && !password)}>
              {busy ? <span className="spinner" /> : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </button>
          </form>
        )}
        {mode === 'signin' && !sent && (
          <button type="button" className="btn ghost small" style={{ justifySelf: 'start' }} onClick={() => { setMode('reset'); setError(null); }}>
            Forgot password?
          </button>
        )}
        {mode === 'reset' && (
          <button type="button" className="btn ghost small" style={{ justifySelf: 'start' }} onClick={() => { setMode('signin'); setSent(null); }}>
            Back to sign in
          </button>
        )}
        <p className="muted" style={{ fontSize: 'var(--t-xs)' }}>XS Gym by Xelorsoft</p>
      </div>
    </AuthLayout>
  );
}

export function SetNewPassword() {
  const { clearRecovery } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (password.length < 8) throw new Error('Password should be at least 8 characters');
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => { toast('Password updated'); clearRecovery(); },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <AuthLayout>
      <form className="auth" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2>Set a new password</h2>
        <Field label="New password" hint="At least 8 characters">
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn primary block" disabled={save.isPending}>Save password</button>
      </form>
    </AuthLayout>
  );
}

export function SetupGym() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const create = useMutation({
    mutationFn: () => rpc<Gym>('create_gym', { p_name: name, p_phone: phone || null }),
    onSuccess: async (gym) => {
      await qc.invalidateQueries({ queryKey: ['my-gyms'] });
      navigate(`/g/${gym.slug}/plans?welcome=1`, { replace: true });
    },
  });
  return (
    <AuthLayout>
      <form className="auth" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="stack">
          <h2>Set up your gym</h2>
          <p className="muted">You will be the owner. The 30-day trial with every feature starts now; staff can be added later.</p>
        </div>
        <Field label="Gym name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus />
        </Field>
        <Field label="Gym phone (optional)">
          <input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {create.error && <Notice tone="bad">{errorMessage(create.error)}</Notice>}
        <button className="btn primary block" disabled={create.isPending || name.trim().length < 2}>
          {create.isPending ? <span className="spinner" /> : 'Create gym'}
        </button>
        <button type="button" className="btn ghost small" style={{ justifySelf: 'start' }} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </form>
    </AuthLayout>
  );
}
