import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Phone, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { BackLink, Empty, Loading, Notice, PushLink, Sheet, StatusBadge, initials, useToast } from '../../components/ui';
import { formatDate, formatDateTime } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { rpc } from '../../lib/supabase';
import { METHOD_LABEL, type Payment } from '../../lib/types';
import { EditPaymentSheet } from '../payments/EditPaymentSheet';
import { PaymentSheet, ReasonSheet, SellPlanSheet } from './actions';
import { useMember, useMemberHistory } from './api';
import { MemberForm } from './MemberForm';
import { WhatsAppButton, reminderFor } from '../../components/WhatsApp';

type Dialog = null | 'sell' | 'pay' | 'edit' | { reverse: string } | { editPayment: Payment } | { voidCharge: string } | 'archive';

export function MemberDetail() {
  const { memberId = '' } = useParams();
  const { gym, can } = useGym();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const member = useMember(gym.id, memberId);
  const canMoney = can('payments.read');
  const history = useMemberHistory(gym.id, memberId, canMoney);
  const [dialog, setDialog] = useState<Dialog>(params.get('sell') === '1' && can('memberships.sell') ? 'sell' : null);
  const base = `/g/${gym.slug}`;

  const close = () => {
    setDialog(null);
    if (params.has('sell')) setParams((p) => { p.delete('sell'); return p; }, { replace: true });
  };
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['member', gym.id, memberId] }),
    qc.invalidateQueries({ queryKey: ['member-history', gym.id, memberId] }),
    qc.invalidateQueries({ queryKey: ['members', gym.id] }),
    qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
    qc.invalidateQueries({ queryKey: ['payments', gym.id] }),
    qc.invalidateQueries({ queryKey: ['payments-archive', gym.id] }),
    qc.invalidateQueries({ queryKey: ['receipt', gym.id] }),
    qc.invalidateQueries({ queryKey: ['analytics', gym.id] }),
  ]);

  if (member.isPending) return <Loading />;
  if (member.error) return <Notice tone="bad">{errorMessage(member.error)}</Notice>;
  const m = member.data;
  if (!m) return <Empty title="Member not found"><Link className="btn" to={`${base}/members`}>Back to members</Link></Empty>;
  const archived = m.status === 'archived';

  return (
    <div className="stack lg">
      <BackLink to={`${base}/members`} className="btn ghost small" style={{ justifySelf: 'start' }}><ArrowLeft size={16} /> Members</BackLink>

      <div className="card stack lg">
        <div className="detail-head">
          <span className="avatar" aria-hidden>{initials(m.full_name)}</span>
          <div style={{ flex: 1, minWidth: 0 }} className="stack">
            <h1 style={{ overflowWrap: 'anywhere' }}>{m.full_name}</h1>
            <div className="row">
              <span className="mono muted">{m.member_no}</span>
              <StatusBadge status={m.membership_status} />
              {archived && <span className="badge neutral">Archived</span>}
            </div>
          </div>
        </div>

        <dl className="kv">
          <dt>Phone</dt><dd><a href={`tel:${m.phone}`}>{m.phone}</a></dd>
          <dt>Plan</dt><dd>{m.plan_name ? `${m.plan_name} · ${formatDate(m.start_date)} – ${formatDate(m.end_date)}` : 'None'}</dd>
          {m.valid_until && m.valid_until !== m.end_date && <><dt>Paid till</dt><dd>{formatDate(m.valid_until)}</dd></>}
          {canMoney && <><dt>Due</dt><dd className="num" style={{ color: m.due_paise > 0 ? 'var(--bad)' : undefined, fontWeight: 600 }}>
            {formatINR(m.due_paise)}{m.credit_paise > 0 ? ` · ${formatINR(m.credit_paise)} credit` : ''}</dd></>}
          <dt>Joined</dt><dd>{formatDate(m.join_date)}</dd>
        </dl>

        {!archived && (
          <div className="row">
            {can('memberships.sell') && <button className="btn" onClick={() => setDialog('sell')}><RefreshCw size={18} /> {m.valid_until ? 'Renew' : 'Sell plan'}</button>}
            {can('payments.record') && <button className="btn" onClick={() => setDialog('pay')}><Wallet size={18} /> Payment</button>}
            {can('members.write') && <button className="btn ghost" onClick={() => setDialog('edit')}><Pencil size={18} /> Edit member</button>}
            {can('members.archive') && <button className="btn ghost danger" onClick={() => setDialog('archive')}><Trash2 size={18} /> Delete member</button>}
            <a className="btn ghost" href={`tel:${m.phone}`}><Phone size={18} /> Call</a>
            <WhatsAppButton small={false} phone={m.phone} {...reminderFor(m, canMoney)} />
          </div>
        )}
        {archived && <div className="row">
          {can('members.archive') && <button className="btn" onClick={() =>
            rpc('set_member_status', { p_gym: gym.id, p_member: m.id, p_status: 'active', p_reason: 'Restored from archive' })
              .then(refresh).then(() => toast('Member restored')).catch((e) => toast(errorMessage(e), 'bad'))}>
            Restore member
          </button>}
          {can('members.write') && <button className="btn ghost" onClick={() => setDialog('edit')}><Pencil size={16} /> Edit member</button>}
          <Link className="btn ghost" to={`${base}/members?filter=archived`}>Archived members</Link>
        </div>}
      </div>

      {history.isPending ? <Loading rows={3} /> : history.error ? <Notice tone="bad">{errorMessage(history.error)}</Notice> : (
        <div className="two-col">
          {canMoney && (
            <section className="card flush">
              <div className="card-head" style={{ padding: '16px 16px 0' }}><h2>Payments</h2></div>
              {history.data.payments.length === 0 ? <Empty title="No payments yet" /> : (
                <ul className="list">
                  {history.data.payments.map((p) => {
                    const reversed = (p.payment_reversals?.length ?? 0) > 0;
                    return (
                      <li key={p.id} className="item" style={{ cursor: 'default' }}>
                        <span className="main-col">
                          <span className="title num" style={{ textDecoration: reversed ? 'line-through' : undefined }}>{formatINR(p.amount_paise)} by {METHOD_LABEL[p.method]}</span>
                          <span className="meta"><span>{formatDateTime(p.received_at, gym.timezone)}</span>{p.reference && <span>{p.reference}</span>}</span>
                          {reversed && <span className="meta">Reversed: {p.payment_reversals![0].reason}</span>}
                        </span>
                        <span className="end-col">
                          <PushLink className="btn small ghost" to={`${base}/receipts/${p.id}`}>Receipt</PushLink>
                          {reversed ? <span className="badge bad">Archived / reversed</span> : (
                            <span className="row" style={{ gap: 6 }}>
                              {can('payments.reverse') && can('payments.record') && (
                                <button className="btn small ghost" onClick={() => setDialog({ editPayment: p })}><Pencil size={14} /> Edit</button>
                              )}
                              {can('payments.reverse') && (
                                <button className="btn small ghost danger" onClick={() => setDialog({ reverse: p.id })}><Trash2 size={14} /> Delete</button>
                              )}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          <section className="card flush">
            <div className="card-head" style={{ padding: '16px 16px 0' }}><h2>Memberships</h2></div>
            {history.data.memberships.length === 0 ? <Empty title="No plans sold yet" /> : (
              <ul className="list">
                {history.data.memberships.map((mm) => (
                  <li key={mm.id} className="item" style={{ cursor: 'default' }}>
                    <span className="main-col">
                      <span className="title">{mm.plan_name}</span>
                      <span className="meta"><span>{formatDate(mm.start_date)} – {formatDate(mm.end_date)}</span><span>{formatINR(mm.price_paise)}</span></span>
                    </span>
                    {mm.status === 'cancelled' && <span className="badge neutral">Cancelled</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {canMoney && history.data.charges.length > 0 && (
            <section className="card flush">
              <div className="card-head" style={{ padding: '16px 16px 0' }}><h2>Charges</h2></div>
              <ul className="list">
                {history.data.charges.map((c) => (
                  <li key={c.id} className="item" style={{ cursor: 'default' }}>
                    <span className="main-col">
                      <span className="title" style={{ textDecoration: c.status === 'void' ? 'line-through' : undefined }}>{c.description}</span>
                      <span className="meta num">
                        {formatINR(c.gross_paise)}{c.discount_paise > 0 ? ` − ${formatINR(c.discount_paise)} discount (${c.discount_reason})` : ''}
                        {c.status === 'void' ? ` · Voided: ${c.void_reason}` : ''}
                      </span>
                    </span>
                    {c.status === 'open' && can('charges.void') && (
                      <button className="btn small ghost" onClick={() => setDialog({ voidCharge: c.id })}>Void</button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

        </div>
      )}

      {archived && <Link className="btn ghost small" to={`${base}/members?filter=archived`} style={{ justifySelf: 'start' }}>
        View Archived members
      </Link>}

      {dialog === 'sell' && <SellPlanSheet member={m} onClose={close} onSold={(due) => setDialog(due && can('payments.record') ? 'pay' : null)} />}
      {dialog === 'pay' && <PaymentSheet member={m} onClose={close} />}
      {dialog === 'edit' && (
        <Sheet title="Edit member" onClose={close}><MemberForm member={m} onDone={close} /></Sheet>
      )}
      {dialog === 'archive' && (
        <ReasonSheet title="Delete member (archive)" confirmLabel="Delete / archive member" onClose={close}
          warning="This moves the member to Members → Archived. Plans and payment history remain intact, and the member can be restored."
          onConfirm={(reason) => rpc('set_member_status', { p_gym: gym.id, p_member: m.id, p_status: 'archived', p_reason: reason }).then(refresh)} />
      )}
      {dialog && typeof dialog === 'object' && 'reverse' in dialog && (
        <ReasonSheet title="Delete payment (archive)" confirmLabel="Delete / reverse payment" onClose={close}
          warning="The payment moves to Payments → Archive (reversed). The receipt remains for audit and dues are recalculated."
          onConfirm={(reason) => rpc('reverse_payment', { p_gym: gym.id, p_payment: dialog.reverse, p_reason: reason })
            .then(refresh).then(() => qc.invalidateQueries({ queryKey: ['payments', gym.id] })).then(() => toast('Payment reversed'))} />
      )}
      {dialog && typeof dialog === 'object' && 'editPayment' in dialog && (
        <EditPaymentSheet payment={dialog.editPayment} onClose={close} />
      )}
      {dialog && typeof dialog === 'object' && 'voidCharge' in dialog && (
        <ReasonSheet title="Void charge" confirmLabel="Void charge" onClose={close}
          warning="The member will no longer owe this amount. Any payment applied to it becomes credit."
          onConfirm={(reason) => rpc('void_charge', { p_gym: gym.id, p_charge: dialog.voidCharge, p_reason: reason }).then(refresh).then(() => toast('Charge voided'))} />
      )}
    </div>
  );
}
