import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Field, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { addDays, formatDate, formatTime, todayInGym } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR, paiseToInput, parseINR } from '../../lib/money';
import { setTransition } from '../../lib/motion';
import { newKey, rpc } from '../../lib/supabase';
import { METHOD_LABEL, type MemberOverview, type Membership, type Method, type Payment } from '../../lib/types';
import { planDuration, usePlans } from './api';

function useRefreshMember(memberId: string) {
  const { gym } = useGym();
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['member', gym.id, memberId] }),
    qc.invalidateQueries({ queryKey: ['member-history', gym.id, memberId] }),
    qc.invalidateQueries({ queryKey: ['members', gym.id] }),
    qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
    qc.invalidateQueries({ queryKey: ['payments', gym.id] }),
    qc.invalidateQueries({ queryKey: ['checkins', gym.id] }),
  ]);
}

/* ---------- Sell or renew a plan ---------- */
export function SellPlanSheet({ member, onClose, onSold }: {
  member: MemberOverview; onClose: () => void; onSold: (dueAfter: boolean) => void;
}) {
  const { gym, can } = useGym();
  const plans = usePlans(gym.id);
  const refresh = useRefreshMember(member.id);
  const toast = useToast();
  const [key] = useState(newKey);
  const [planId, setPlanId] = useState('');
  const [customStart, setCustomStart] = useState(false);
  const [start, setStart] = useState('');
  const [discount, setDiscount] = useState('');
  const [reason, setReason] = useState('');
  const [admission, setAdmission] = useState('');
  const plan = plans.data?.find((p) => p.id === planId);
  const discountPaise = discount ? parseINR(discount) : 0;
  const admissionPaise = admission ? parseINR(admission) : 0;
  const total = plan ? plan.price_paise - (discountPaise ?? 0) + (admissionPaise ?? 0) : 0;
  const renewing = !!member.valid_until;
  // Preview of the server's rule (the database decides): continue after the
  // current end date if still within grace, otherwise start today.
  const today = todayInGym(gym.timezone);
  const autoStart = member.valid_until && today <= addDays(member.valid_until, gym.grace_days) ? addDays(member.valid_until, 1) : today;
  const invalid = !plan || discountPaise === null || admissionPaise === null
    || (discountPaise ?? 0) > (plan?.price_paise ?? 0) || ((discountPaise ?? 0) > 0 && !reason.trim())
    || (customStart && !start);

  const sell = useMutation({
    mutationFn: () => rpc<Membership>('sell_membership', {
      p_gym: gym.id, p_member: member.id, p_plan: planId, p_idempotency_key: key,
      p_start_date: customStart ? start : null, p_discount_paise: discountPaise ?? 0,
      p_discount_reason: reason || null, p_admission_fee_paise: admissionPaise ?? 0,
    }),
    onSuccess: async (mm) => {
      await refresh();
      toast(`${mm.plan_name}: ${formatDate(mm.start_date)} – ${formatDate(mm.end_date)}`);
      onSold(total > 0);
    },
  });

  return (
    <Sheet title={renewing ? 'Renew membership' : 'Sell a plan'} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (!invalid) sell.mutate(); }}>
        {plans.data?.length === 0 && <Notice tone="warn">No plans yet. Add plans first under Plans.</Notice>}
        <div className="stack" role="radiogroup" aria-label="Plan">
          {plans.data?.map((p) => (
            <button type="button" key={p.id} role="radio" aria-checked={planId === p.id}
              className={`btn block ${planId === p.id ? 'primary' : ''}`} style={{ justifyContent: 'space-between' }}
              onClick={() => setPlanId(p.id)}>
              <span>{p.name} · {planDuration(p)}</span>
              <span className="num">{formatINR(p.price_paise)}</span>
            </button>
          ))}
        </div>

        {!customStart && <p className="muted">Starts {formatDate(autoStart)}</p>}
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={customStart} onChange={(e) => setCustomStart(e.target.checked)} />
          Different start date
        </label>
        {customStart && (
          <Field label="Start date">
            <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
        )}

        <div className="grid-2">
          {!renewing && (
            <Field label="Admission fee (optional)" error={admissionPaise === null ? 'Enter a valid amount' : null}>
              <input className="input" inputMode="decimal" placeholder="₹0" value={admission} onChange={(e) => setAdmission(e.target.value)} />
            </Field>
          )}
          {can('discounts.apply') && (
            <Field label="Discount (optional)" error={discountPaise === null || (plan && (discountPaise ?? 0) > plan.price_paise) ? 'Enter a valid amount up to the plan price' : null}>
              <input className="input" inputMode="decimal" placeholder="₹0" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
          )}
        </div>
        {(discountPaise ?? 0) > 0 && (
          <Field label="Reason for discount">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}

        {plan && (
          <div className="card" style={{ background: 'var(--surface-2)', border: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Amount to collect</span>
              <strong className="num" style={{ fontSize: '1.25rem' }}>{formatINR(total)}</strong>
            </div>
            {member.credit_paise > 0 && <p className="muted">{formatINR(member.credit_paise)} credit will be used</p>}
          </div>
        )}
        {sell.error && <Notice tone="bad">{errorMessage(sell.error)}</Notice>}
        <button className="btn primary block" disabled={invalid || sell.isPending}>
          {sell.isPending ? <span className="spinner" /> : renewing ? 'Confirm renewal' : 'Confirm sale'}
        </button>
      </form>
    </Sheet>
  );
}

/* ---------- Record a payment ---------- */
const METHODS: { value: Method; label: string }[] = [
  { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' },
];

export function PaymentSheet({ member, onClose }: { member: MemberOverview; onClose: () => void }) {
  const { gym } = useGym();
  const navigate = useNavigate();
  const refresh = useRefreshMember(member.id);
  const toast = useToast();
  const [key] = useState(newKey);
  const [amount, setAmount] = useState(member.due_paise > 0 ? paiseToInput(member.due_paise) : '');
  const [method, setMethod] = useState<Method>('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const paise = parseINR(amount);

  const pay = useMutation({
    mutationFn: () => rpc<Payment>('record_payment', {
      p_gym: gym.id, p_member: member.id, p_amount_paise: paise, p_method: method,
      p_idempotency_key: key, p_reference: reference || null, p_notes: notes || null,
    }),
    onSuccess: async (p) => {
      await refresh();
      toast(`${formatINR(p.amount_paise)} ${METHOD_LABEL[p.method]} recorded`);
      onClose();
      setTransition('push');
      navigate(`/g/${gym.slug}/receipts/${p.id}`, { viewTransition: true });
    },
  });

  return (
    <Sheet title="Record payment" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (paise) pay.mutate(); }}>
        <p className="muted">
          {member.due_paise > 0 ? `${formatINR(member.due_paise)} due` : 'Nothing due'}
        </p>
        <Field label="Amount received" error={amount && paise === null ? 'Enter an amount like 1500 or 1500.50' : null}>
          <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
            style={{ fontSize: '1.25rem', fontWeight: 600 }} aria-invalid={!!amount && paise === null} autoFocus />
        </Field>
        <Segmented label="Payment method" value={method} options={METHODS} onChange={setMethod} />
        {method !== 'cash' && (
          <Field label={method === 'upi' ? 'UPI reference (optional)' : 'Reference (optional)'}
            hint="Confirm the money arrived before saving.">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
        )}
        <Field label="Note (optional)">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {pay.error && <Notice tone="bad">{errorMessage(pay.error)}</Notice>}
        <button className="btn primary block" disabled={!paise || pay.isPending}>
          {pay.isPending ? <span className="spinner" /> : paise ? `Record ${formatINR(paise)} ${METHOD_LABEL[method]}` : 'Record payment'}
        </button>
      </form>
    </Sheet>
  );
}

/* ---------- Check in ---------- */
export function CheckInButton({ member, compact = false }: { member: MemberOverview; compact?: boolean }) {
  const { gym, can } = useGym();
  const refresh = useRefreshMember(member.id);
  const toast = useToast();
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const blocked = !['active', 'grace'].includes(member.membership_status);

  const checkIn = useMutation({
    mutationFn: (overrideReason: string | null) =>
      rpc<{ checked_in_at: string }>('check_in', { p_gym: gym.id, p_member: member.id, p_override_reason: overrideReason }),
    onSuccess: async (e) => {
      await refresh();
      toast(`${member.full_name} checked in at ${formatTime(e.checked_in_at, gym.timezone)}`);
      setOverride(false);
      setReason('');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  if (blocked && !can('attendance.override')) {
    return <button className={`btn ${compact ? 'small' : ''}`} disabled title="Membership is not active">Not active</button>;
  }
  return (
    <>
      <button className={`btn ${blocked ? '' : 'primary'} ${compact ? 'small' : ''}`} disabled={checkIn.isPending}
        onClick={() => (blocked ? setOverride(true) : checkIn.mutate(null))}>
        {checkIn.isPending ? <span className="spinner" /> : <><ScanLine size={compact ? 16 : 18} /> {blocked ? 'Override' : 'Check in'}</>}
      </button>
      {override && (
        <Sheet title="Check in with override" onClose={() => setOverride(false)}>
          <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) checkIn.mutate(reason); }}>
            <Notice tone="warn">
              Membership is {member.membership_status === 'none' ? 'not set up' : member.membership_status}. Your reason is logged.
            </Notice>
            <Field label="Reason">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. paying tomorrow" />
            </Field>
            <button className="btn primary block" disabled={!reason.trim() || checkIn.isPending}>Check in anyway</button>
          </form>
        </Sheet>
      )}
    </>
  );
}

/* ---------- Generic reason prompt (reversals, voids, archive) ---------- */
export function ReasonSheet({ title, warning, confirmLabel, onClose, onConfirm }: {
  title: string; warning: string; confirmLabel: string; onClose: () => void; onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const run = useMutation({ mutationFn: () => onConfirm(reason.trim()), onSuccess: onClose });
  return (
    <Sheet title={title} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) run.mutate(); }}>
        <Notice tone="warn">{warning}</Notice>
        <Field label="Reason (required)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {run.error && <Notice tone="bad">{errorMessage(run.error)}</Notice>}
        <button className="btn danger block" disabled={!reason.trim() || run.isPending}>{confirmLabel}</button>
      </form>
    </Sheet>
  );
}
