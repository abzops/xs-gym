import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer, Share2 } from 'lucide-react';
import { useParams } from 'react-router';
import { useGym } from '../../app/gym';
import { BackLink, Empty, Loading, Notice, useToast } from '../../components/ui';
import { formatDateTime } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import { METHOD_LABEL, type Method } from '../../lib/types';

type ReceiptData = {
  id: string; amount_paise: number; method: Method; received_at: string; reference: string | null; notes: string | null;
  member_id: string;
  members: { full_name: string; member_no: string; phone: string } | null;
  payment_allocations: { amount_paise: number; charges: { description: string } | null }[];
  payment_reversals: { reason: string; reversed_at: string }[];
};

export const receiptNo = (id: string) => id.replace(/-/g, '').slice(0, 10).toUpperCase();

export function ReceiptPage() {
  const { paymentId = '' } = useParams();
  const { gym } = useGym();
  const toast = useToast();
  const receipt = useQuery({
    queryKey: ['receipt', gym.id, paymentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('payments')
        .select('id, amount_paise, method, received_at, reference, notes, member_id, members(full_name, member_no, phone), payment_allocations(amount_paise, charges(description)), payment_reversals(reason, reversed_at)')
        .eq('gym_id', gym.id).eq('id', paymentId).maybeSingle();
      if (error) throw error;
      return data as unknown as ReceiptData | null;
    },
  });

  if (receipt.isPending) return <Loading rows={3} />;
  if (receipt.error) return <Notice tone="bad">{errorMessage(receipt.error)}</Notice>;
  const r = receipt.data;
  if (!r) return <Empty title="Receipt not found" />;
  const reversed = r.payment_reversals.length > 0;
  const allocated = r.payment_allocations.reduce((s, a) => s + a.amount_paise, 0);
  const no = receiptNo(r.id);
  const text = [
    `${gym.name} — Payment receipt ${no}`,
    `${r.members?.full_name} (${r.members?.member_no})`,
    `${formatINR(r.amount_paise)} by ${METHOD_LABEL[r.method]} on ${formatDateTime(r.received_at, gym.timezone)}`,
    ...r.payment_allocations.map((a) => `• ${a.charges?.description}: ${formatINR(a.amount_paise)}`),
    reversed ? 'This payment was reversed.' : 'Thank you.',
  ].join('\n');

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `Receipt ${no}`, text });
      else { await navigator.clipboard.writeText(text); toast('Receipt copied — paste it into WhatsApp or SMS'); }
    } catch { /* person closed the share sheet */ }
  }

  return (
    <div className="stack lg" style={{ maxWidth: 560 }}>
      <div className="row no-print">
        <BackLink to={`/g/${gym.slug}/members/${r.member_id}`} className="btn ghost small"><ArrowLeft size={16} /> Member</BackLink>
        <span style={{ flex: 1 }} />
        <button className="btn small" onClick={share}><Share2 size={16} /> Share</button>
        <button className="btn small" onClick={() => window.print()}><Printer size={16} /> Print</button>
      </div>

      <article className="card stack lg receipt" aria-label={`Receipt ${no}`}>
        <header className="stack">
          <h1>{gym.name}</h1>
          {(gym.address || gym.phone) && <p className="muted">{[gym.address, gym.phone].filter(Boolean).join(' · ')}</p>}
        </header>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label">Payment receipt</span>
          <span className="mono">No. {no}</span>
        </div>
        {reversed && <Notice tone="bad">Reversed on {formatDateTime(r.payment_reversals[0].reversed_at, gym.timezone)}: {r.payment_reversals[0].reason}</Notice>}
        <dl className="kv">
          <dt>Received from</dt><dd>{r.members?.full_name} · <span className="mono">{r.members?.member_no}</span></dd>
          <dt>Date</dt><dd>{formatDateTime(r.received_at, gym.timezone)}</dd>
          <dt>Method</dt><dd>{METHOD_LABEL[r.method]}{r.method !== 'cash' ? ' (verified by staff)' : ''}</dd>
          {r.reference && <><dt>Reference</dt><dd>{r.reference}</dd></>}
        </dl>
        <table className="data">
          <thead><tr><th>For</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {r.payment_allocations.map((a, i) => (
              <tr key={i}><td style={{ whiteSpace: 'normal' }}>{a.charges?.description}</td><td className="r num">{formatINR(a.amount_paise)}</td></tr>
            ))}
            {r.amount_paise - allocated > 0 && (
              <tr><td>Advance / credit</td><td className="r num">{formatINR(r.amount_paise - allocated)}</td></tr>
            )}
          </tbody>
          <tfoot><tr><td>Total received</td><td className="r num" style={{ textDecoration: reversed ? 'line-through' : undefined }}>{formatINR(r.amount_paise, { showZeroPaise: true })}</td></tr></tfoot>
        </table>
        <p className="muted" style={{ fontSize: 'var(--t-xs)' }}>Computer-generated receipt.</p>
      </article>
    </div>
  );
}
