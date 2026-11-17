import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Field, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { addDays, daysBetween, formatDate, membershipEndDate, todayInGym } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR, paiseToInput, parseINR } from '../../lib/money';
import { setTransition } from '../../lib/motion';
import { newKey, rpc } from '../../lib/supabase';
import { METHOD_LABEL, type MemberOverview, type Membership, type Method, type Payment } from '../../lib/types';
import { planDuration, usePlans } from './api';

/**
 * Lets a submit run once until it settles. A fast double tap fires two submit
 * events before React re-renders the disabled button; without this the second
 * one re-runs onSuccess (a second toast and a second receipt in history).
 */
function useOnce() {
  const busy = useRef(false);
  return (start: (done: { onSettled: () => void }) => void) => {
    if (busy.current) return;
    busy.current = true;
    start({ onSettled: () => { busy.current = false; } });
  };
}

function useRefreshMember(memberId: string) {
  const { gym } = useGym();
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['member', gym.id, memberId] }),
    qc.invalidateQueries({ queryKey: ['member-history', gym.id, memberId] }),
    qc.invalidateQueries({ queryKey: ['members', gym.id] }),
    qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
    qc.invalidateQueries({ queryKey: ['payments', gym.id] }),
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

  const once = useOnce();
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
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (!invalid) once((o) => sell.mutate(undefined, o)); }}>
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

  const once = useOnce();
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
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (paise) once((o) => pay.mutate(undefined, o)); }}>
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

/* ---------- Generic reason prompt (reversals, voids, archive) ---------- */
export function ReasonSheet({ title, warning, confirmLabel, onClose, onConfirm }: {
  title: string; warning: string; confirmLabel: string; onClose: () => void; onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const once = useOnce();
  const run = useMutation({ mutationFn: () => onConfirm(reason.trim()), onSuccess: onClose });
  return (
    <Sheet title={title} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) once((o) => run.mutate(undefined, o)); }}>
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

/* ---------- Pause (freeze) a membership ---------- */
const PAUSE_PRESETS = [7, 15, 30, 60];
export function PauseSheet({ member, onClose }: { member: MemberOverview; onClose: () => void }) {
  const { gym } = useGym();
  const refresh = useRefreshMember(member.id);
  const toast = useToast();
  const today = todayInGym(gym.timezone);
  const [days, setDays] = useState('15');
  const [start, setStart] = useState(today);
  const [reason, setReason] = useState('');
  const once = useOnce();
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= 180 && reason.trim().length >= 3 && start >= today;
  const run = useMutation({
    mutationFn: () => rpc('pause_membership', { p_gym: gym.id, p_member: member.id, p_days: n, p_reason: reason.trim(), p_start_date: start }),
    onSuccess: async () => { await refresh(); toast(`Paused for ${n} days`); onClose(); },
  });
  const newEnd = member.end_date && valid ? addDays(member.end_date, n) : null;
  return (
    <Sheet title="Pause membership" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (valid) once((o) => run.mutate(undefined, o)); }}>
        <p className="muted">{member.full_name} keeps the paused days: the plan end date moves forward, and any renewal already sold moves with it.</p>
        <Field label="How many days?">
          <div className="row" style={{ gap: 8 }}>
            {PAUSE_PRESETS.map((d) => (
              <button type="button" key={d} className={'btn small' + (n === d ? ' primary' : ' ghost')} aria-pressed={n === d} onClick={() => setDays(String(d))}>{d} days</button>
            ))}
            <input className="input" style={{ width: 96 }} inputMode="numeric" value={days} aria-label="Days"
              onChange={(e) => setDays(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </div>
        </Field>
        <Field label="Pause starts">
          <input className="input" type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Reason (required)">
          <input className="input" value={reason} placeholder="e.g. Travelling, injury, exams" onChange={(e) => setReason(e.target.value)} />
        </Field>
        {newEnd && <Notice tone="info">Back on {formatDate(addDays(start, n))}. Plan now ends {formatDate(newEnd)} (was {formatDate(member.end_date)}).</Notice>}
        {run.error && <Notice tone="bad">{errorMessage(run.error)}</Notice>}
        <button className="btn primary block" disabled={!valid || run.isPending}>Pause for {Number.isInteger(n) && n > 0 ? n : '…'} days</button>
      </form>
    </Sheet>
  );
}

/* ---------- Edit (backdate) a membership's dates ---------- */
export function EditDatesSheet({ member, membership, previousEnd, onClose }: {
  member: MemberOverview; membership: Membership; previousEnd: string | null; onClose: () => void;
}) {
  const { gym } = useGym();
  const plans = usePlans(gym.id, true);
  const refresh = useRefreshMember(member.id);
  const toast = useToast();
  const once = useOnce();
  const plan = plans.data?.find((p) => p.id === membership.plan_id);
  const [start, setStart] = useState(membership.start_date);
  const [manualEnd, setManualEnd] = useState(false);
  const [end, setEnd] = useState(membership.end_date);
  const [moveFollowing, setMoveFollowing] = useState(true);
  const [reason, setReason] = useState('');
  const newEnd = manualEnd ? end : plan && start ? membershipEndDate(start, plan.duration_unit, plan.duration_count) : '';
  const shift = newEnd ? daysBetween(membership.end_date, newEnd) : 0;
  const unchanged = start === membership.start_date && newEnd === membership.end_date;
  const error = !start || !newEnd ? 'Choose the dates' : newEnd < start ? 'End date cannot be before the start date'
    : unchanged ? 'Dates are unchanged' : reason.trim().length < 3 ? 'Give a reason' : null;
  const run = useMutation({
    mutationFn: () => rpc<Membership>('update_membership_dates', {
      p_gym: gym.id, p_membership: membership.id, p_start_date: start, p_reason: reason.trim(),
      p_end_date: manualEnd ? end : null, p_move_following: moveFollowing,
    }),
    onSuccess: async (mm) => { await refresh(); toast(`${mm.plan_name}: ${formatDate(mm.start_date)} – ${formatDate(mm.end_date)}`); onClose(); },
  });
  const today = todayInGym(gym.timezone);
  return (
    <Sheet title="Edit membership dates" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (!error) once((o) => run.mutate(undefined, o)); }}>
        <p className="muted">{membership.plan_name}{plan ? ` · ${planDuration(plan)}` : ''} · now {formatDate(membership.start_date)} – {formatDate(membership.end_date)}</p>
        {previousEnd && addDays(previousEnd, 1) !== start && (
          <button type="button" className="btn small ghost" style={{ justifySelf: 'start' }} onClick={() => { setStart(addDays(previousEnd, 1)); setManualEnd(false); }}>
            Start right after the previous plan ({formatDate(addDays(previousEnd, 1))})
          </button>
        )}
        <Field label="Start date">
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={manualEnd} onChange={(e) => { setManualEnd(e.target.checked); if (e.target.checked && newEnd) setEnd(newEnd); }} />
          Set the end date myself
        </label>
        {manualEnd ? (
          <Field label="End date (last valid day)">
            <input className="input" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        ) : <p>Ends <strong>{formatDate(newEnd)}</strong> <span className="muted">(from the plan length)</span></p>}
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={moveFollowing} onChange={(e) => setMoveFollowing(e.target.checked)} />
          Move renewals already sold after this plan by the same days
        </label>
        <Field label="Reason (required)">
          <input className="input" value={reason} placeholder="e.g. Paid late, cycle starts on the due date" onChange={(e) => setReason(e.target.value)} />
        </Field>
        {newEnd && !unchanged && newEnd >= start && (
          <Notice tone="info">
            New period {formatDate(start)} – {formatDate(newEnd)}: {shift === 0 ? 'same end date' : `${Math.abs(shift)} day${Math.abs(shift) === 1 ? '' : 's'} ${shift < 0 ? 'shorter' : 'longer'}`}.
            {newEnd < today ? ' This period has already ended.' : ` ${daysBetween(today, newEnd) + 1} days left.`} Payments stay as they are.
          </Notice>
        )}
        {run.error && <Notice tone="bad">{errorMessage(run.error)}</Notice>}
        <button className="btn primary block" disabled={!!error || run.isPending}>{error && error !== 'Give a reason' ? error : 'Save dates'}</button>
      </form>
    </Sheet>
  );
}
