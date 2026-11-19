// Shown in place of a page whose feature is not in the gym's plan. Data is never
// hidden by plan changes; only creating new items is plan-gated on the server.
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { FEATURE_PLAN } from '../../lib/billingApi';
import './billing.css';

export function UpgradePrompt({ feature, title, children }: { feature: string; title: string; children: ReactNode }) {
  const { gym, can, entitlements } = useGym();
  return (
    <div className="card upgrade-card">
      <span className="icon" aria-hidden><Lock size={22} /></span>
      <h2>{title}</h2>
      <p>{children}</p>
      <p>Included in <b>{FEATURE_PLAN[feature] ?? 'Growth'}</b> and higher plans{entitlements?.plan_name ? ` · you are on ${entitlements.plan_name}` : ''}.</p>
      {can('billing.manage')
        ? <Link className="btn primary" to={`/g/${gym.slug}/billing`}>See plans</Link>
        : <p>Ask the gym owner to upgrade.</p>}
    </div>
  );
}

/** Wraps a page: shows the prompt when the plan lacks the feature. */
export function RequireFeature({ feature, title, why, children }: { feature: string; title: string; why: string; children: ReactNode }) {
  const { has } = useGym();
  if (!has(feature)) return <UpgradePrompt feature={feature} title={title}>{why}</UpgradePrompt>;
  return <>{children}</>;
}
