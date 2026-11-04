import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Field, Notice, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { setTransition } from '../../lib/motion';
import { rpc } from '../../lib/supabase';
import type { MemberOverview } from '../../lib/types';

type Values = {
  full_name: string; phone: string; email: string; gender: string;
  date_of_birth: string; address: string; emergency_contact: string;
};

const empty: Values = { full_name: '', phone: '', email: '', gender: '', date_of_birth: '', address: '', emergency_contact: '' };

export function MemberForm({ member, onDone }: { member?: MemberOverview; onDone?: () => void }) {
  const { gym } = useGym();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState<Values>(() => member ? {
    full_name: member.full_name, phone: member.phone.replace(/^\+91/, ''), email: member.email ?? '',
    gender: member.gender ?? '', date_of_birth: member.date_of_birth ?? '', address: member.address ?? '',
    emergency_contact: member.emergency_contact ?? '',
  } : empty);
  const [more, setMore] = useState(!!member);
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const args = {
        p_gym: gym.id, p_full_name: v.full_name, p_phone: v.phone, p_email: v.email || null,
        p_gender: v.gender || null, p_date_of_birth: v.date_of_birth || null, p_address: v.address || null,
        p_emergency_contact: v.emergency_contact || null,
      };
      return member
        ? rpc<{ id: string }>('update_member', { ...args, p_member: member.id })
        : rpc<{ id: string }>('create_member', args);
    },
    onSuccess: async (saved) => {
      await qc.invalidateQueries({ queryKey: ['members', gym.id] });
      await qc.invalidateQueries({ queryKey: ['member', gym.id, saved.id] });
      toast(member ? 'Member updated' : 'Member added');
      if (onDone) onDone();
      else { setTransition('push'); navigate(`/g/${gym.slug}/members/${saved.id}?sell=1`, { replace: true, viewTransition: true }); }
    },
  });

  const phoneDigits = v.phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length >= 10;
  const valid = v.full_name.trim().length > 0 && phoneOk;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) save.mutate();
  }

  return (
    <form className="stack lg" onSubmit={submit} noValidate>
      <div className="grid-2">
        <Field label="Full name">
          <input className="input" value={v.full_name} onChange={set('full_name')} autoComplete="off" required autoFocus={!member} />
        </Field>
        <Field label="Mobile number" error={v.phone && !phoneOk ? 'Enter 10 digits' : null}>
          <input className="input" type="tel" inputMode="tel" value={v.phone} onChange={set('phone')} autoComplete="off" required
            aria-invalid={!!v.phone && !phoneOk} />
        </Field>
      </div>

      {!more ? (
        <button type="button" className="btn ghost small" onClick={() => setMore(true)} style={{ justifySelf: 'start' }}>
          <ChevronDown size={16} /> More details
        </button>
      ) : (
        <div className="grid-2">
          <Field label="Email">
            <input className="input" type="email" inputMode="email" value={v.email} onChange={set('email')} />
          </Field>
          <Field label="Gender">
            <select className="input" value={v.gender} onChange={set('gender')}>
              <option value="">Not specified</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Date of birth">
            <input className="input" type="date" value={v.date_of_birth} onChange={set('date_of_birth')} />
          </Field>
          <Field label="Emergency contact" hint="Name and phone">
            <input className="input" value={v.emergency_contact} onChange={set('emergency_contact')} />
          </Field>
          <Field label="Address">
            <textarea className="input" value={v.address} onChange={set('address')} rows={2} />
          </Field>
        </div>
      )}

      {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
      <div className="row end">
        {onDone && <button type="button" className="btn" onClick={onDone}>Cancel</button>}
        <button className="btn primary" disabled={!valid || save.isPending}>
          {save.isPending ? <span className="spinner" /> : member ? 'Save changes' : 'Add member'}
        </button>
      </div>
    </form>
  );
}

export function NewMemberPage() {
  return (
    <div className="stack lg" style={{ maxWidth: 720 }}>
      <div className="page-head"><h1>Add member</h1></div>
      <div className="card"><MemberForm /></div>
    </div>
  );
}
