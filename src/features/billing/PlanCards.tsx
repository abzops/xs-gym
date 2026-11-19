// Three plan cards with a monthly / yearly switch. Used by the public pricing
// page and by Settings → Subscription. Prices come from the server; drafts are
// marked "Provisional" and never presented as final.
import { Check, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Segmented } from '../../components/ui';
import { formatINR } from '../../lib/money';
import { yearlySaving, type Cycle, type Feature, type Pricing, type PublicPlan } from '../../lib/billingApi';

export function CycleSwitch({ cycle, onChange, pricing }: { cycle: Cycle; onChange: (c: Cycle) => void; pricing?: Pricing }) {
  const best = Math.max(0, ...(pricing?.plans ?? []).map((p) => (p.monthly_paise ? Math.round(yearlySaving(p) * 100 / (p.monthly_paise * 12)) : 0)));
  return (
    <div className="cycle-switch">
      <Segmented<Cycle> label="Billing period" value={cycle} onChange={onChange}
        options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: best > 0 ? `Yearly · save ${best}%` : 'Yearly' }]} />
    </div>
  );
}

export function limitText(n: number | null, noun: string) {
  return n === null ? `Unlimited ${noun}` : `Up to ${n.toLocaleString('en-IN')} ${noun}`;
}

/** Card lines: limits, then core features (Starter) or only what this plan adds. */
export function planLines(plan: PublicPlan, features: Feature[], plans: PublicPlan[]) {
  const lines: Array<{ text: string; on: boolean; head?: boolean }> = [
    { text: limitText(plan.member_limit, 'active members'), on: true },
    { text: plan.staff_limit === null ? 'Unlimited staff logins' : `${plan.staff_limit} staff login${plan.staff_limit === 1 ? '' : 's'} + owner`, on: true },
  ];
  const lower = [...plans].filter((p) => p.rank < plan.rank).sort((a, b) => b.rank - a.rank)[0];
  const inPlan = (p: PublicPlan, f: Feature) => !(f.gated || f.key === 'priority_support') || p.features[f.key as keyof PublicPlan['features']] !== false;
  if (lower) lines.push({ text: `Everything in ${lower.name}, plus:`, on: true, head: true });
  for (const f of features) {
    if (!f.available) {
      if (plan.addons.includes('extra_branch') && f.key === 'multi_branch') lines.push({ text: `${f.label} (coming soon)`, on: false });
      continue;
    }
    if (inPlan(plan, f) && (!lower || !inPlan(lower, f))) lines.push({ text: f.label, on: true });
  }
  return lines;
}

export function PlanCards({ pricing, cycle, current, featured = 'growth', action }: {
  pricing: Pricing; cycle: Cycle; current?: string | null; featured?: string;
  action: (plan: PublicPlan) => ReactNode;
}) {
  return (
    <div className="plan-grid">
      {pricing.plans.map((p) => {
        const price = cycle === 'monthly' ? p.monthly_paise : p.annual_paise;
        const perMonth = cycle === 'annual' && p.annual_paise ? Math.round(p.annual_paise / 1200) * 100 : null;
        const save = cycle === 'annual' ? yearlySaving(p) : 0;
        return (
          <article key={p.id} className={`plan-card ${p.id === featured ? 'featured' : ''} ${current === p.id ? 'current' : ''}`} aria-label={`${p.name} plan`}>
            <div className="plan-top">
              <h3>{p.name}</h3>
              {current === p.id ? <span className="badge ok">Your plan</span>
                : p.id === featured ? <span className="badge neutral">Most popular</span> : null}
            </div>
            <p className="tagline">{p.tagline}</p>
            <div className="plan-price" aria-live="polite">
              <span className="amount">{price ? formatINR(price) : '—'}</span>
              <span className="per">{price ? (cycle === 'monthly' ? '/ month' : '/ year') : 'not sold this way'}</span>
            </div>
            <p className="plan-price-note">
              {perMonth ? <>{formatINR(perMonth)} a month{save > 0 && <span className="save-chip">Save {formatINR(save)}</span>}</> : ' '}
            </p>
            {p.provisional && <span className="provisional-pill" title="Prices are not final until Xelorsoft confirms them">Provisional price</span>}
            <ul className="plan-feats">
              {planLines(p, pricing.features, pricing.plans).map((l) => (
                l.head ? <li key={l.text} className="head">{l.text}</li> : (
                  <li key={l.text} className={l.on ? '' : 'soon'}>
                    {l.on ? <Check size={16} strokeWidth={2.4} aria-label="Included" /> : <Minus size={16} aria-label="Not yet available" />}
                    <span>{l.text}</span>
                  </li>
                )
              ))}
            </ul>
            <div className="grow" />
            {action(p)}
          </article>
        );
      })}
    </div>
  );
}

export function CompareTable({ pricing }: { pricing: Pricing }) {
  const plans = pricing.plans;
  const cell = (on: boolean) => (on ? <Check size={16} strokeWidth={2.4} aria-label="Included" /> : <Minus size={16} aria-label="Not included" />);
  return (
    <div className="compare-wrap card flush">
      <table className="compare">
        <thead><tr><th scope="col">Feature</th>{plans.map((p) => <th key={p.id} scope="col">{p.name}</th>)}</tr></thead>
        <tbody>
          <tr><td>Active members</td>{plans.map((p) => <td key={p.id}>{p.member_limit === null ? 'Unlimited' : p.member_limit.toLocaleString('en-IN')}</td>)}</tr>
          <tr><td>Staff logins (besides the owner)</td>{plans.map((p) => <td key={p.id}>{p.staff_limit === null ? 'Unlimited' : p.staff_limit}</td>)}</tr>
          <tr><td>Locations</td>{plans.map((p) => <td key={p.id}>{p.branch_limit}</td>)}</tr>
          {pricing.features.map((f) => (
            <tr key={f.key}>
              <td>{f.label}{!f.available && <div className="soon">Coming soon — not part of any plan yet</div>}</td>
              {plans.map((p) => <td key={p.id}>{f.available ? cell(!(f.gated || f.key === 'priority_support') || p.features[f.key as keyof PublicPlan['features']] !== false) : '—'}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One sentence on tax, from server settings — never assumes GST registration. */
export function taxLine(terms: Pricing['terms']) {
  if (terms.gst_status === 'registered') {
    return terms.prices_include_gst ? `Prices include GST (${terms.gst_rate_bp / 100}%). A GST invoice is issued for every payment.`
      : `GST (${terms.gst_rate_bp / 100}%) is added at checkout. A GST invoice is issued for every payment.`;
  }
  if (terms.gst_status === 'not_registered') return 'GST is not charged. A payment receipt is issued for every payment.';
  return 'The price shown is the total you pay. A receipt is issued for every payment.';
}
