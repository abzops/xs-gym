import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Field, Loading, Notice } from '../../components/ui';
import { addDays, formatDate, formatTime, todayInGym } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import { METHOD_LABEL, type Method, type Payment } from '../../lib/types';

/** Start of a gym-local day as an absolute timestamp (IST is a fixed +05:30). */
function dayStart(date: string) {
  return `${date}T00:00:00+05:30`;
}

export function PaymentsPage() {
  const { gym } = useGym();
  const [day, setDay] = useState(() => todayInGym(gym.timezone));
  const payments = useQuery({
    queryKey: ['payments', gym.id, day],
    queryFn: async () => {
      const { data, error } = await supabase.from('payments')
        .select('*, members(full_name, member_no), payment_reversals(id, reason, reversed_at)')
        .eq('gym_id', gym.id).gte('received_at', dayStart(day)).lt('received_at', dayStart(addDays(day, 1)))
        .order('received_at', { ascending: false });
      if (error) throw error;
      return data as Payment[];
    },
  });

  const live = payments.data?.filter((p) => !p.payment_reversals?.length) ?? [];
  const byMethod = live.reduce<Partial<Record<Method, number>>>((acc, p) => ({ ...acc, [p.method]: (acc[p.method] ?? 0) + p.amount_paise }), {});
  const total = live.reduce((s, p) => s + p.amount_paise, 0);
  const base = `/g/${gym.slug}`;

  return (
    <div className="stack lg">
      <div className="page-head">
        <h1>Payments</h1>
        <Field label="Day">
          <input className="input" type="date" value={day} max={todayInGym(gym.timezone)} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </Field>
      </div>

      <div className="tiles">
        <div className="tile"><span className="label">Received · {formatDate(day)}</span><span className="value">{formatINR(total)}</span>
          <span className="sub">{live.length} payment{live.length === 1 ? '' : 's'}, excluding reversed</span></div>
        {(['cash', 'upi'] as Method[]).map((m) => (
          <div className="tile" key={m}><span className="label">{METHOD_LABEL[m]}</span><span className="value">{formatINR(byMethod[m] ?? 0)}</span></div>
        ))}
        <div className="tile"><span className="label">Card / bank / other</span>
          <span className="value">{formatINR((byMethod.card ?? 0) + (byMethod.bank ?? 0) + (byMethod.other ?? 0))}</span></div>
      </div>
      <p className="muted">To record a payment, open the member and tap Payment. UPI and bank entries are manually verified by staff.</p>

      {payments.isPending ? <Loading /> : payments.error ? <Notice tone="bad">{errorMessage(payments.error)}</Notice> :
        payments.data.length === 0 ? <div className="card"><Empty title="No payments on this day" /></div> : (
          <ul className="list card flush">
            {payments.data.map((p) => {
              const reversed = !!p.payment_reversals?.length;
              return (
                <li key={p.id}>
                  <Link className="item" to={`${base}/receipts/${p.id}`}>
                    <span className="main-col">
                      <span className="title">{p.members?.full_name}</span>
                      <span className="meta">{formatTime(p.received_at, gym.timezone)} · {METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
                    </span>
                    <span className="end-col">
                      <span className="num" style={{ fontWeight: 600, textDecoration: reversed ? 'line-through' : undefined }}>{formatINR(p.amount_paise)}</span>
                      {reversed && <span className="badge bad">Reversed</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
