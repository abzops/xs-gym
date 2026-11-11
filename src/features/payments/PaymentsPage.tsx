import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Trash2, Archive } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Field, Loading, Notice, PushLink, useToast } from '../../components/ui';
import { formatDate, formatDateTime, formatTime, todayInGym } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { paymentsDayQuery } from '../../lib/sections';
import { rpc, supabase } from '../../lib/supabase';
import { METHOD_LABEL, type Method, type Payment } from '../../lib/types';
import { ReasonSheet } from '../members/actions';
import { EditPaymentSheet } from './EditPaymentSheet';

export function PaymentsPage() {
  const { gym, can } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const archive = params.get('view') === 'archive';
  const [day, setDay] = useState(() => todayInGym(gym.timezone));
  const [editing, setEditing] = useState<Payment | null>(null);
  const [deleting, setDeleting] = useState<Payment | null>(null);
  const payments = useQuery({ ...paymentsDayQuery(gym.id, day), enabled: !archive });
  const archived = useQuery({
    queryKey: ['payments-archive', gym.id],
    enabled: archive,
    queryFn: async () => {
      const { data, error } = await supabase.from('payments')
        .select('*, members(full_name,member_no), payment_reversals!inner(id, reason, reversed_at)')
        .eq('gym_id', gym.id).order('received_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data as Payment[];
    },
  });

  const live = payments.data?.filter((p) => !p.payment_reversals?.length) ?? [];
  const byMethod = live.reduce<Partial<Record<Method, number>>>((acc, p) =>
    ({ ...acc, [p.method]: (acc[p.method] ?? 0) + p.amount_paise }), {});
  const total = live.reduce((sum, p) => sum + p.amount_paise, 0);
  const base = `/g/${gym.slug}`;
  const list = archive ? archived.data : live;
  const busy = archive ? archived.isPending : payments.isPending;
  const failure = archive ? archived.error : payments.error;

  const updateView = (next: boolean) => setParams((old) => {
    if (next) old.set('view', 'archive');
    else old.delete('view');
    return old;
  }, { replace: true });

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['payments', gym.id] }),
      qc.invalidateQueries({ queryKey: ['payments-archive', gym.id] }),
      qc.invalidateQueries({ queryKey: ['receipt', gym.id] }),
      qc.invalidateQueries({ queryKey: ['member', gym.id] }),
      qc.invalidateQueries({ queryKey: ['member-history', gym.id] }),
      qc.invalidateQueries({ queryKey: ['members', gym.id] }),
      qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
      qc.invalidateQueries({ queryKey: ['analytics', gym.id] }),
      qc.invalidateQueries({ queryKey: ['daily-report', gym.id] }),
    ]);
  };

  return (
    <div className="stack lg">
      <div className="page-head">
        <h1>Payments</h1>
        {!archive && <Field label="Day">
          <input className="input" type="date" value={day} max={todayInGym(gym.timezone)}
            onChange={(e) => e.target.value && setDay(e.target.value)} />
        </Field>}
      </div>
      <div className="row" role="group" aria-label="Payment record view">
        <button type="button" className={`btn ${!archive ? 'primary' : ''}`}
          aria-pressed={!archive} onClick={() => updateView(false)}>Payments</button>
        <button type="button" className={`btn ${archive ? 'primary' : ''}`}
          aria-pressed={archive} onClick={() => updateView(true)}>
          <Archive size={16} /> Archive (reversed)
        </button>
      </div>
      {archive ? <Notice tone="warn">
        Archived payments are reversed or deleted entries. They stay here with their original
        receipts, reversal reasons and dates for audit. They are excluded from active collections.
        Showing the latest 100 reversed payments across all dates.
      </Notice> : (
        <div className="tiles">
          <div className="tile"><span className="label">Received on {formatDate(day)}</span>
            <span className="value">{formatINR(total)}</span><span className="sub">
              {live.length} payment{live.length === 1 ? '' : 's'}</span></div>
          {(['cash', 'upi'] as Method[]).map((m) => (
            <div className="tile" key={m}><span className="label">{METHOD_LABEL[m]}</span>
              <span className="value">{formatINR(byMethod[m] ?? 0)}</span></div>
          ))}
          <div className="tile"><span className="label">Card / bank / other</span>
            <span className="value">{formatINR((byMethod.card ?? 0) + (byMethod.bank ?? 0) + (byMethod.other ?? 0))}</span></div>
        </div>
      )}
      {busy ? <Loading /> : failure ? <Notice tone="bad">{errorMessage(failure)}</Notice> :
        !list?.length ? <div className="card"><Empty title={archive ? 'No archived payments' : 'No active payments on this day'} /></div> : (
          <ul className="list card flush">
            {list.map((p) => {
              const reversed = !!p.payment_reversals?.length;
              return (
                <li key={p.id}>
                  <div className="item">
                    <PushLink className="main-col" to={`${base}/receipts/${p.id}`}>
                      <span className="title">{p.members?.full_name ?? 'Member'}</span>
                      <span className="meta">
                        <span className="mono">{archive ? formatDateTime(p.received_at, gym.timezone) : formatTime(p.received_at, gym.timezone)}</span>
                        <span>{METHOD_LABEL[p.method]}</span>
                        {p.reference && <span>{p.reference}</span>}
                      </span>
                      {reversed && <span className="meta">
                        Archived: {p.payment_reversals?.[0]?.reason ?? 'Reversed'}
                      </span>}
                    </PushLink>
                    <span className="end-col">
                      <span className="num" style={{ fontWeight: 600, textDecoration: reversed ? 'line-through' : undefined }}>
                        {formatINR(p.amount_paise)}
                      </span>
                      {reversed ? <span className="badge bad">Reversed</span> : (
                        <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          {can('payments.record') && can('payments.reverse') && (
                            <button type="button" className="btn small ghost" onClick={() => setEditing(p)}
                              aria-label={`Edit payment for ${p.members?.full_name ?? 'member'}`}>
                              <Pencil size={15} /> Edit
                            </button>
                          )}
                          {can('payments.reverse') && (
                            <button type="button" className="btn small ghost danger" onClick={() => setDeleting(p)}
                              aria-label={`Delete payment for ${p.members?.full_name ?? 'member'}`}>
                              <Trash2 size={15} /> Delete
                            </button>
                          )}
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      {editing && <EditPaymentSheet key={editing.id} payment={editing} onClose={() => setEditing(null)} />}
      {deleting && <ReasonSheet title="Delete payment (archive)" confirmLabel="Delete / reverse payment"
        warning="This reverses the payment and moves it to Payments → Archive (reversed). The receipt stays for audit; dues and collections are recalculated. This cannot be undone directly."
        onClose={() => setDeleting(null)}
        onConfirm={(reason) => rpc('reverse_payment', { p_gym: gym.id, p_payment: deleting.id, p_reason: reason })
          .then(refresh).then(() => toast('Payment moved to archive (reversed)'))} />}
    </div>
  );
}
