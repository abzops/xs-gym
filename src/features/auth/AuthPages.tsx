import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../../app/auth';
import { Field, Logo, Notice, Segmented, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';
import type { Gym } from '../../lib/types';

const appUrl = () => new URL(import.meta.env.BASE_URL, window.location.origin).toString();

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

  return (
    <div className="center-screen">
      <div className="auth">
        <Logo />
        <div>
          <h1>XS Gym</h1>
          <p className="muted">Members, payments and attendance for your gym.</p>
        </div>
        <div className="card stack">
          <Segmented
            label="Account"
            value={mode === 'reset' ? 'signin' : mode}
            onChange={(v) => { setMode(v); setError(null); setSent(null); }}
            options={[{ value: 'signin', label: 'Sign in' }, { value: 'signup', label: 'Create account' }]}
          />
          {sent ? (
            <Notice tone="ok">{sent}</Notice>
          ) : (
            <form className="stack" onSubmit={submit} noValidate>
              {mode === 'reset' && <p className="muted">Enter your email and we will send a link to set a new password.</p>}
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
              {mode === 'signin' && (
                <button type="button" className="btn ghost small" onClick={() => { setMode('reset'); setError(null); }}>
                  Forgot password?
                </button>
              )}
              {mode === 'reset' && (
                <button type="button" className="btn ghost small" onClick={() => setMode('signin')}>Back to sign in</button>
              )}
            </form>
          )}
        </div>
        <p className="label">AI. Software. Digital.</p>
      </div>
    </div>
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
    <div className="center-screen">
      <form className="auth card stack" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h1>Set a new password</h1>
        <Field label="New password" hint="At least 8 characters">
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn primary block" disabled={save.isPending}>Save password</button>
      </form>
    </div>
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
    <div className="center-screen">
      <form className="auth stack lg" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Logo />
        <div className="stack">
          <h1>Set up your gym</h1>
          <p className="muted">You will be the owner. Your 30-day trial with every feature starts now. Staff can be added later.</p>
        </div>
        <div className="card stack">
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
          <button type="button" className="btn ghost small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </form>
    </div>
  );
}
