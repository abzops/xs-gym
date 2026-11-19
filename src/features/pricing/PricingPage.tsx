// Public pricing (no sign-in): three plans, monthly/yearly switch, comparison,
// terms. Prices come from public_pricing(); drafts show as provisional.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Loading, Logo, Notice } from '../../components/ui';
import { loadPricing, type Cycle } from '../../lib/billingApi';
import { errorMessage } from '../../lib/errors';
import '../landing/landing.css';
import '../billing/billing.css';
import { CompareTable, CycleSwitch, PlanCards, taxLine } from '../billing/PlanCards';

export function PricingPage() {
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const pricing = useQuery({ queryKey: ['public-pricing'], queryFn: loadPricing, staleTime: 5 * 60_000 });
  const provisional = pricing.data?.plans.some((p) => p.provisional);
  const trialDays = pricing.data?.terms.trial_days ?? 30;

  return (
    <div className="lp">
      <header className="lp-nav scrolled">
        <div className="lp-wrap lp-nav-in">
          <Link to="/" aria-label="XS Gym home"><Logo onDark width={132} /></Link>
          <nav className="lp-links" aria-label="Sections">
            <Link to="/">Product</Link><a href="#compare">Compare</a><a href="#terms">Terms</a>
          </nav>
          <div className="row">
            <Link className="btn ghost on-dark" to="/login">Sign in</Link>
            <Link className="btn primary on-dark hide-phone" to="/login?mode=signup">Start free trial</Link>
          </div>
        </div>
      </header>

      <section className="lp-section dark pr-hero">
        <div className="lp-wrap">
          <h1>Simple prices.<br />Every rupee shown.</h1>
          <p>{trialDays}-day free trial with every feature. No card needed. Pay monthly or yearly — nothing renews by itself.</p>
        </div>
      </section>

      <main className="pr-body">
        <div className="lp-wrap stack xl">
          {pricing.isPending ? <Loading rows={6} /> : pricing.error ? <Notice tone="bad">{errorMessage(pricing.error)}</Notice> : (
            <>
              {provisional && (
                <Notice tone="warn">These prices are provisional and may change before launch. You will always see the final price before you pay.</Notice>
              )}
              <CycleSwitch cycle={cycle} onChange={setCycle} pricing={pricing.data} />
              <PlanCards pricing={pricing.data} cycle={cycle} action={(p) => (
                <Link className={`btn block ${p.id === 'growth' ? 'primary' : ''}`} to={`/login?mode=signup&plan=${p.id}`}>
                  Start {trialDays}-day free trial
                </Link>
              )} />
              <p className="pr-note">{taxLine(pricing.data.terms)} Prices in Indian rupees.</p>

              <section id="compare" className="stack">
                <h2>Compare plans</h2>
                <CompareTable pricing={pricing.data} />
              </section>

              <section id="terms" className="card stack">
                <h2>Billing, renewals and your data</h2>
                <dl className="pr-faq">
                  <dt>What happens after the free trial?</dt>
                  <dd>Choose a plan and pay for a month or a year. If you don’t, your gym becomes read-only: you can still see and export everything, and it unlocks the moment you pay.</dd>
                  <dt>Will I be charged automatically?</dt>
                  <dd>No. Each payment buys one period. We remind you before it ends, and you pay for the next one when you choose.</dd>
                  <dt>Can I change plans?</dt>
                  <dd>Yes. Upgrading starts at once and the unused days of your current period are credited. Moving to a smaller plan starts when your paid period ends.</dd>
                  <dt>Hidden charges or add-ons?</dt>
                  <dd>None. There are no setup fees. {pricing.data.addons.length > 0
                    ? `Planned add-ons (${pricing.data.addons.map((a) => a.label).join(', ')}) are not on sale yet; their price will be shown before anyone can buy them.`
                    : ''}</dd>
                  <dt>Payment terms</dt>
                  <dd>{pricing.data.terms.payment_terms}</dd>
                  <dt>Questions about billing?</dt>
                  <dd>Write to <a href={`mailto:${pricing.data.terms.support_email}`}>{pricing.data.terms.support_email}</a>.</dd>
                </dl>
              </section>
            </>
          )}
        </div>
      </main>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <Logo width={110} />
          <span>XS Gym by Xelorsoft</span>
          <span>© 2026 Xelorsoft</span>
        </div>
      </footer>
    </div>
  );
}
