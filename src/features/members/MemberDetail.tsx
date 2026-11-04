import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Phone, RefreshCw, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Loading, Notice, Sheet, StatusBadge, initials, useToast } from '../../components/ui';
import { formatDate, formatDateTime } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { rpc } from '../../lib/supabase';
import { METHOD_LABEL } from '../../lib/types';
import { CheckInButton, PaymentSheet, ReasonSheet, SellPlanSheet } from './actions';
import { useMember, useMemberHistory } from './api';
import { MemberForm } from './MemberForm';

type Dialog = null | 'sell' | 'pay' | 'edit' | { reverse: string } | { voidCharge: string } | { voidCheckIn: string } | 'archive';

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
  ]);

  if (member.isPending) return <Loading />;
  if (member.error) return <Notice tone="bad">{errorMessage(member.error)}</Notice>;
  const m = member.data;
  if (!m) return <Empty title="Member not found"><Link className="btn" to={`${base}/members`}>Back to members</Link></Empty>;
  const archived = m.status === 'archived';

  return (
    <div className="stack lg">
      <Link to={`${base}/members`} className="btn ghost small" style={{ justifySelf: 'start' }}><ArrowLeft size={16} /> Members</Link>

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
          <dt>Last visit</dt><dd>{m.last_check_in_at ? formatDateTime(m.last_check_in_at, gym.timezone) : 'Never'}</dd>
          <dt>Joined</dt><dd>{formatDate(m.join_date)}</dd>
        </dl>

        {!archived && (
          <div className="row">
            {can('attendance.checkin') && <CheckInButton member={m} />}
            {can('memberships.sell') && <button className="btn" onClick={() => setDialog('sell')}><RefreshCw size={18} /> {m.valid_until ? 'Renew' : 'Sell plan'}</button>}
            {can('payments.record') && <button className="btn" onClick={() => setDialog('pay')}><Wallet size={18} /> Payment</button>}
            {can('members.write') && <button className="btn ghost" onClick={() => setDialog('edit')}><Pencil size={18} /> Edit</button>}
            <a className="btn ghost" href={`tel:${m.phone}`}><Phone size={18} /> Call</a>
          </div>
        )}
        {archived && can('members.archive') && (
          <button className="btn" style={{ justifySelf: 'start' }}
            onClick={() => rpc('set_member_status', { p_gym: gym.id, p_member: m.id, p_status: 'active', p_reason: 'Restored' })
              .then(refresh).then(() => toast('Member restored')).catch((e) => toast(errorMessage(e), 'bad'))}>
            Restore member
          </button>
        )}
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
                          <span className="title num" style={{ textDecoration: reversed ? 'line-through' : undefined }}>{formatINR(p.amount_paise)} · {METHOD_LABEL[p.method]}</span>
                          <span className="meta">{formatDateTime(p.received_at, gym.timezone)}{p.reference ? ` · ${p.reference}` : ''}</span>
                          {reversed && <span className="meta">Reversed: {p.payment_reversals![0].reason}</span>}
                        </span>
                        <span className="end-col">
                          <Link className="btn small ghost" to={`${base}/receipts/${p.id}`}>Receipt</Link>
                          {reversed ? <span className="badge bad">Reversed</span> : can('payments.reverse') && (
                            <button className="btn small ghost" onClick={() => setDialog({ reverse: p.id })}>Reverse</button>
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
                      <span className="meta">{formatDate(mm.start_date)} – {formatDate(mm.end_date)} · {formatINR(mm.price_paise)}</span>
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

          <section className="card flush">
            <div className="card-head" style={{ padding: '16px 16px 0' }}><h2>Recent visits</h2></div>
            {history.data.attendance.length === 0 ? <Empty title="No visits yet" /> : (
              <ul className="list">
                {history.data.attendance.map((a) => (
                  <li key={a.id} className="item" style={{ cursor: 'default' }}>
                    <span className="main-col">
                      <span className="title" style={{ textDecoration: a.voided_at ? 'line-through' : undefined }}>{formatDateTime(a.checked_in_at, gym.timezone)}</span>
                      {a.override_reason && <span className="meta">Override: {a.override_reason}</span>}
                      {a.voided_at && <span className="meta">Removed: {a.void_reason}</span>}
                    </span>
                    {!a.voided_at && can('attendance.correct') && (
                      <button className="btn small ghost" onClick={() => setDialog({ voidCheckIn: a.id })}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {can('members.archive') && !archived && (
        <button className="btn ghost small danger" style={{ justifySelf: 'start' }} onClick={() => setDialog('archive')}>Archive member</button>
      )}

      {dialog === 'sell' && <SellPlanSheet member={m} onClose={close} onSold={(due) => setDialog(due && can('payments.record') ? 'pay' : null)} />}
      {dialog === 'pay' && <PaymentSheet member={m} onClose={close} />}
      {dialog === 'edit' && (
        <Sheet title="Edit member" onClose={close}><MemberForm member={m} onDone={close} /></Sheet>
      )}
      {dialog === 'archive' && (
        <ReasonSheet title="Archive member" confirmLabel="Archive" onClose={close}
          warning="Archived members are hidden from lists and cannot check in. Their history is kept and they can be restored."
          onConfirm={(reason) => rpc('set_member_status', { p_gym: gym.id, p_member: m.id, p_status: 'archived', p_reason: reason }).then(refresh)} />
      )}
      {dialog && typeof dialog === 'object' && 'reverse' in dialog && (
        <ReasonSheet title="Reverse payment" confirmLabel="Reverse payment" onClose={close}
          warning="The payment stays in history marked as reversed, and the member's dues are recalculated."
          onConfirm={(reason) => rpc('reverse_payment', { p_gym: gym.id, p_payment: dialog.reverse, p_reason: reason })
            .then(refresh).then(() => qc.invalidateQueries({ queryKey: ['payments', gym.id] })).then(() => toast('Payment reversed'))} />
      )}
      {dialog && typeof dialog === 'object' && 'voidCharge' in dialog && (
        <ReasonSheet title="Void charge" confirmLabel="Void charge" onClose={close}
          warning="The member will no longer owe this amount. Any payment applied to it becomes credit."
          onConfirm={(reason) => rpc('void_charge', { p_gym: gym.id, p_charge: dialog.voidCharge, p_reason: reason }).then(refresh).then(() => toast('Charge voided'))} />
      )}
      {dialog && typeof dialog === 'object' && 'voidCheckIn' in dialog && (
        <ReasonSheet title="Remove check-in" confirmLabel="Remove check-in" onClose={close}
          warning="The check-in is kept in history marked as removed."
          onConfirm={(reason) => rpc('void_check_in', { p_gym: gym.id, p_event: dialog.voidCheckIn, p_reason: reason }).then(refresh).then(() => toast('Check-in removed'))} />
      )}
    </div>
  );
}
