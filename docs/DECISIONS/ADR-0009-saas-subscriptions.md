# ADR-0009 — SaaS subscriptions: prepaid periods, versioned plans, server-side entitlements

Date: 19 Nov 2026 · Status: proposed (branch `feat/saas-subscriptions`, awaiting founder approval)

## Context
XS Gym needs three fixed-price plans with a 30-day trial, sold in India, without
disturbing pilot gyms or mixing Xelorsoft's revenue with gyms' member money. A
payment-link checkout (one price) was already live.

## Decision
* Keep Razorpay **payment links** as the checkout: each payment buys one prepaid period
  (1 or 12 months). Nothing renews automatically. Autopay can be added later behind the
  same gateway-event ledger.
* Plans have **versions**; a version is a draft until a Xelorsoft owner activates it.
  Subscribers stay on the version they paid for.
* One subscription row per gym (`gym_subscriptions`, extended) with a validated state
  machine; the effective state is computed from time so access never depends on a cron job.
* Entitlements are enforced in the database (triggers, wrapped functions) and the XS AI
  function; the UI only mirrors them.
* Every existing gym is grandfathered as a complimentary pilot; the old single price
  becomes the hidden "launch" plan.
* Xelorsoft admin rights live in `platform_admins`, separate from gym roles.

## Consequences
Owners renew by paying (reminders, banners, grace period). Price changes need a new
version and an approval note. Legacy columns are kept in sync, so older app builds and the
rollback keep working. See `docs/BILLING.md`.
