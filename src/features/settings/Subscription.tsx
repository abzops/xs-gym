// Settings → Subscription: plan status and paying for XS Gym (Razorpay payment links).
// The owner picks a price, pays on Razorpay's page and comes back here with
// ?billing=<payment id>; the server confirms with Razorpay before anything changes.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Notice } from '../../components/ui';
import { checkSubscriptionPayment, loadBillingStatus, loadPrices, loadSubscriptionPayments, startSubscriptionPayment, type SaasPayment } from '../../lib/billingApi';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';

const day = (iso: string | null | undefined) => (iso ? formatDate(iso.slice(0, 10)) : '');

const STATUS: Record<SaasPayment['status'], { label: string; tone: string }> = {
  paid: { label: 'Paid', tone: 'ok' }, created: { label: 'Not finished', tone: 'warn' },
  expired: { label: 'Link expired', tone: '' }, cancelled: { label: 'Cancelled', tone: '' }, failed: { label: 'Failed', tone: 'bad' },
};

export function SubscriptionSection() {
  const { gym, can, subscription, canWrite } = useGym();
  const owner = can('billing.manage');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const returned = params.get('billing');

  // Payment is open with live keys, or with test keys only for Xelorsoft's test gyms.
  const billing = useQuery({ queryKey: ['saas-billing-status'], queryFn: loadBillingStatus, enabled: owner, staleTime: 10 * 60_000, retry: 1 });
  const open = !!billing.data?.configured && (billing.data.mode === 'live' || !!subscription?.billing_test);
  const prices = useQuery({ queryKey: ['saas-prices'], queryFn: loadPrices, enabled: owner && open, staleTime: 10 * 60_000 });
  const history = useQuery({ queryKey: ['saas-payments', gym.id], queryFn: () => loadSubscriptionPayments(gym.id), enabled: owner });

  const start = useMutation({
    mutationFn: (price: string) => {
      const back = new URL(window.location.href);
      back.search = '';
      back.hash = '';
      return startSubscriptionPayment(gym.id, price, back.toString());
    },
    onSuccess: ({ url }) => { window.location.assign(url); },
  });

  // Back from Razorpay: confirm on the server, then refresh the gym.
  const [result, setResult] = useState<{ status: SaasPayment['status']; paid_until?: string | null } | null>(null);
  const check = useMutation({
    mutationFn: (id: string) => checkSubscriptionPayment(gym.id, id),
    onSuccess: async (r) => {
      setResult(r);
      if (r.status === 'paid') await qc.invalidateQueries({ queryKey: ['gym'] });
      await qc.invalidateQueries({ queryKey: ['saas-payments', gym.id] });
    },
  });
  const checked = useRef<string | null>(null);
  useEffect(() => {
    if (!returned || !owner || checked.current === returned) return;
    checked.current = returned;
    check.mutate(returned);
    // Drop Razorpay's query parameters but keep the payment id for "Check again".
    const next = new URLSearchParams();
    next.set('billing', returned);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned, owner]);

  const monthly = prices.data?.find((p) => p.months === 1);
  const periodEnd = subscription?.status === 'trial' ? subscription.trial_ends_at : subscription?.paid_until;
  const stillRunning = !!periodEnd && Date.parse(periodEnd) > Date.now();

  return (
    <section className="card stack">
      <h2>Subscription</h2>
      {subscription ? (
        <dl className="kv">
          <dt>Plan</dt><dd>XS Gym{subscription.status === 'trial' ? ' (free trial)' : ''}</dd>
          {subscription.status === 'trial' && subscription.trial_ends_at && <><dt>Trial ends</dt><dd>{day(subscription.trial_ends_at)}</dd></>}
          {subscription.paid_until && <><dt>Paid until</dt><dd>{day(subscription.paid_until)}</dd></>}
          {!canWrite && <><dt>Status</dt><dd><span className="tag bad">Ended</span></dd></>}
        </dl>
      ) : <p className="muted">No subscription found.</p>}

      {returned && owner && (
        check.isPending ? <Notice>Checking your payment with Razorpay…</Notice>
        : check.isError ? <Notice tone="bad">{errorMessage(check.error)}</Notice>
        : result?.status === 'paid' ? <Notice tone="ok">Payment received. XS Gym is paid until {day(result.paid_until)}. Thank you!</Notice>
        : result?.status === 'created' ? (
          <Notice tone="warn">
            The payment is not finished yet. If you paid, it can take a minute to show.{' '}
            <button type="button" className="btn small" onClick={() => check.mutate(returned)}><RefreshCw size={14} /> Check again</button>
          </Notice>
        )
        : result ? <Notice tone="warn">That payment link has {result.status === 'expired' ? 'expired' : 'been cancelled'}. Start a new payment below.</Notice>
        : null
      )}

      {owner && !open ? (
        <Notice>
          {billing.isPending ? 'Checking online payment…'
            : stillRunning
              ? `Online payment for XS Gym is opening soon. Your access continues until ${day(periodEnd)}, and Xelorsoft will contact you before then.`
              : 'Online payment for XS Gym is opening soon. Please contact Xelorsoft at support@xelorsoft.com to renew.'}
        </Notice>
      ) : owner ? (
        <div className="stack">
          <p className="muted">
            {stillRunning
              ? `Paying now adds time after your ${subscription?.status === 'trial' ? 'trial' : 'current period'} ends on ${day(periodEnd)}. You lose no days.`
              : 'Pay to continue using XS Gym. Your data is safe and everything unlocks as soon as the payment is confirmed.'}
          </p>
          {prices.isError && <Notice tone="bad">{errorMessage(prices.error)}</Notice>}
          <div className="grid-2">
            {prices.data?.map((p) => {
              const save = monthly && p.months > 1 ? monthly.amount_paise * p.months - p.amount_paise : 0;
              return (
                <button key={p.code} type="button" className={`btn ${p.months > 1 ? 'primary' : ''} block`}
                  disabled={start.isPending} onClick={() => start.mutate(p.code)}>
                  <CreditCard size={16} />
                  {start.isPending && start.variables === p.code
                    ? 'Opening Razorpay…'
                    : `${p.label}: ${formatINR(p.amount_paise)}${save > 0 ? ` (save ${formatINR(save)})` : ''}`}
                </button>
              );
            })}
          </div>
          {start.isError && <Notice tone="bad">{errorMessage(start.error)}</Notice>}
          <p className="muted small">Pay with UPI, card or net banking on Razorpay's secure page.</p>

          {!!history.data?.length && (
            <div className="stack">
              <h3>Payments</h3>
              <ul className="list">
                {history.data.map((h) => (
                  <li key={h.id} className="row" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>
                      <b>{formatINR(h.amount_paise)}</b> · {h.months === 1 ? '1 month' : `${h.months} months`}
                      <br /><small className="muted">{day(h.paid_at ?? h.created_at)}{h.period_end ? ` · until ${day(h.period_end)}` : ''}</small>
                    </span>
                    <span style={{ display: 'flex', gap: 6 }}>
                      {h.mode === 'test' && <span className="tag">Test</span>}
                      <span className={`tag ${STATUS[h.status].tone}`}>{STATUS[h.status].label}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="muted">Only the gym owner can pay for XS Gym.</p>
      )}
    </section>
  );
}
