import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { Field, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { formatINR, paiseToInput, parseINR } from '../../lib/money';
import { newKey, rpc } from '../../lib/supabase';
import { METHOD_LABEL, type Method, type Payment } from '../../lib/types';

const METHODS: { value: Method; label: string }[] = [
  { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' }, { value: 'bank', label: 'Bank' }, { value: 'other', label: 'Other' },
];

/** Corrections reverse the old entry and record an audited replacement in ONE
 * database transaction. Original receipt and payment history remain intact. */
export function EditPaymentSheet({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { gym } = useGym();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [key] = useState(newKey);
  const busy = useRef(false);
  const [amount, setAmount] = useState(() => paiseToInput(payment.amount_paise));
  const [method, setMethod] = useState<Method>(payment.method);
  const [reference, setReference] = useState(payment.reference ?? '');
  const [notes, setNotes] = useState(payment.notes ?? '');
  const [reason, setReason] = useState('');
  const paise = parseINR(amount);
  const changed = paise !== payment.amount_paise || method !== payment.method ||
    reference.trim() !== (payment.reference ?? '').trim() || notes.trim() !== (payment.notes ?? '').trim();

  const save = useMutation({
    mutationFn: () => rpc<Payment>('correct_payment', {
      p_gym: gym.id, p_payment: payment.id, p_amount_paise: paise,
      p_method: method, p_reference: reference.trim() || null,
      p_notes: notes.trim() || null, p_reason: reason.trim(),
      p_idempotency_key: key,
    }),
    onSuccess: async (next) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['payments', gym.id] }),
        qc.invalidateQueries({ queryKey: ['member', gym.id] }),
        qc.invalidateQueries({ queryKey: ['member-history', gym.id] }),
        qc.invalidateQueries({ queryKey: ['members', gym.id] }),
        qc.invalidateQueries({ queryKey: ['receipt', gym.id] }),
        qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
        qc.invalidateQueries({ queryKey: ['analytics', gym.id] }),
        qc.invalidateQueries({ queryKey: ['daily-report', gym.id] }),
      ]);
      toast('Payment corrected. Original moved to Payments → Archive (reversed).');
      onClose();
      navigate(`/g/${gym.slug}/receipts/${next.id}`);
    },
    onSettled: () => { busy.current = false; },
  });

  const valid = !!paise && changed && reason.trim().length >= 3;
  const submit = () => {
    if (!valid || busy.current) return;
    busy.current = true;
    save.mutate();
  };
  return (
    <Sheet title="Edit payment" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Notice tone="warn">
          Financial records cannot be overwritten. Save will reverse the original receipt and
          record a corrected replacement dated today. The original remains in
          Payments → Archive (reversed), with an audit trail. Check the details before saving.
        </Notice>
        <Field label="Correct amount received" error={amount && !paise ? 'Enter a valid amount' : null}>
          <input className="input num" inputMode="decimal" autoFocus
            value={amount} onChange={(e) => setAmount(e.target.value)}
            aria-invalid={!!amount && !paise} />
        </Field>
        <Segmented label="Payment method" value={method} options={METHODS} onChange={setMethod} />
        <Field label="UPI / bank / card reference (optional)">
          <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Note (optional)">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Field label="Reason for correction (required)">
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="For example: wrong amount or payment method" />
        </Field>
        {save.error && <Notice tone="bad">{errorMessage(save.error)}</Notice>}
        <button className="btn primary block" disabled={!valid || save.isPending}>
          {save.isPending ? <span className="spinner" /> :
            paise ? `Save corrected ${formatINR(paise)} ${METHOD_LABEL[method]}` : 'Save correction'}
        </button>
      </form>
    </Sheet>
  );
}
