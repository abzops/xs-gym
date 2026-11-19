# XS Gym — Subscriptions, pricing and billing

Status (19 Nov 2026): built and tested on branch `feat/saas-subscriptions`.
**Not deployed. No production data, billing setting or price was changed.**
Everything below that needs a founder is listed in §11.

## 1. Audit before the change (Phase 1, confirmed on the live project)

| Area | Finding |
|---|---|
| Tenancy | One `gyms` row per customer; `gym_staff` links users to gyms with a role (owner, manager, reception, trainer). Permissions come from `role_permissions`; every write goes through a `security definer` command that calls `private.require` (permission + subscription check). RLS on every table. |
| Existing billing | Commit `459d7dc` (19 Nov, live): one price (`saas_prices`: ₹499/month, ₹4,990/year), Razorpay **payment links**, server-side confirmation (`xs-billing` `check`, `xs-billing-webhook`), `apply_saas_payment` adds months to `gym_subscriptions.paid_until`. No plans, entitlements, invoices or event ledger. 0 payments recorded. |
| Subscription model | `gym_subscriptions(status trial/active/suspended, trial_ends_at, paid_until)`; `private.can_write` = trial not ended or `paid_until` in the future. Expired = read-only (D-06). |
| Pilot gyms | XS Fitness Studio (demo, active to Nov 2027), CHAOS COMBAT and Super Gym (trials). **Under the current live rule, both trials become read-only on 9 Dec 2026.** |
| Trial abuse | Only "one gym per account". A new email gets a new trial. |
| Risks found | Test-mode Razorpay payments grant real access; webhook has no event-id dedupe/ledger; `saas_prices` editable only by SQL, no history; no invoices; Supabase free plan has no backups; SaaS money and member money already separate (good). |
| Environments | Only production Supabase projects exist (free limit of 2 per owner reached), so the non-production database for this work is local PostgreSQL 16 with all real migrations (`tests/db`). |

## 2. Plans and entitlements

Prices are **provisional suggestions** (§7) stored as *draft* plan versions. They show as
"Provisional price" and can be paid only with Razorpay **test** keys until an owner
activates a version.

| | Starter | Growth | Pro |
|---|---|---|---|
| Suggested price (monthly / yearly) | ₹499 / ₹4,990 | ₹999 / ₹9,990 | ₹1,999 / ₹19,990 |
| Active members | 200 | 1,000 | Unlimited |
| Staff logins (besides owner) | 2 | 6 | 20 |
| Members, plans, renewals, payments, receipts, expenses, dues/expiry lists, WhatsApp reminders (manual), CSV import/export, pause, edit dates, daily report | ✓ | ✓ | ✓ |
| Analytics (charts and KPIs) | — | ✓ | ✓ |
| Enquiries (new leads) | — | ✓ | ✓ |
| XS AI assistant | — | ✓ | ✓ |
| Priority WhatsApp support | — | — | ✓ |
| Multi-branch | not built — shown as "coming soon", sold by no plan |

Why this split: everything a front desk needs every day is in every plan (never
lock a gym out of its own operations). The paid differences are the features
that cost money to run (XS AI), that grow with the business (analytics, leads,
more staff/members), and service (priority support). Member limits sit well
above typical small gyms in Kerala (the pilot gyms have 2–79 members).

Hidden plans: **pilot** (everything, no limits — complimentary for pilot gyms) and
**launch** (the ₹499 single price that was live, so anyone who paid it keeps
exactly those terms).

### Enforcement (server first)
* Member limit: trigger on `members` (insert / restore to active).
* Staff limit: trigger on `gym_staff` (active non-owner rows).
* Enquiries: trigger on insert; existing enquiries stay visible and editable.
* Analytics: `gym_analytics` checks the plan (original moved to `private.gym_analytics_core`).
* XS AI: the `xs-ai` function reads `gym_entitlements` and answers 402 before any model call.
* The UI mirrors these (`useGym().has(feature)`), never decides them.
* Customers cannot change `gym_subscriptions`, plan versions, settings or admins (no grants; tested).

## 3. Subscription states

`gym_subscriptions.state` with validated transitions (`private.saas_transition_ok`):

```
TRIALING ──pay──► ACTIVE ──period ends──► PAST_DUE ──3 days──► GRACE_PERIOD ──7 days──► EXPIRED
   │                 │  ▲                     │                      │                      │
   │cancel           │  └──────── pay ────────┴──────────────────────┘◄────── pay ───────────┘
   ▼                 ▼cancel
CANCELED ──period/trial end──► EXPIRED          (resume before the end → back to ACTIVE/TRIALING)
```

* Full access: TRIALING, ACTIVE, PAST_DUE, GRACE_PERIOD, CANCELED (until it takes effect).
* EXPIRED: read-only by default (`expired_access = read_only`), or `billing_only`
  (configurable). Data is never deleted; export stays available.
* `private.saas_effective_state` computes the state from time, so access is right
  even if the hourly `billing_tick()` has not run; the tick records the change and
  queues reminders (trial ends in 7/3/1 days, renewal due in 7/3/1 days, past due, grace).
* Every change is a row in `saas_subscription_events` (append-only).
* Old columns (`status`, `plan`, `paid_until`) stay in sync for older app builds and rollback.
  A hand edit of the old columns is translated into the new model and logged.

### Trial
30 days (setting), features of the trial plan (Pro). Once per customer: the owner's
email (Gmail dots/+tags removed) and the gym phone are hashed into
`saas_trial_registry`; a match starts the gym EXPIRED with a clear "choose a plan".
Admins can extend or restore a trial (audited).

### Changes
* **Upgrade** (higher plan, or monthly → yearly): starts now; unused value of the
  current paid period is credited (pro-rata by time). Invoice shows list price, credit, total.
* **Downgrade**: scheduled for the end of the paid period (`schedule_plan_change`); can be paid ahead.
* **Renewal**: adds a period from the current end date — no days lost. Paying during the
  trial starts the paid period when the trial ends.
* **Price changes** never touch existing subscribers: renewals of the same plan use the
  subscriber's version; new versions apply to new purchases only.
* **Cancel**: nothing is charged automatically, so cancel = end at period end, stop
  reminders. Resume before then.

## 4. Payments (Razorpay)

### Evaluation
| Option | For | Against |
|---|---|---|
| **Payment links, prepaid periods (chosen for launch)** | Already live and integrated; works with UPI, cards, net banking; no mandate set-up for older owners; no recurring-mandate limits; no subscription add-on fee; customer stays in control ("nothing renews by itself") | Renewal needs the owner to pay (reminders + banner); no automatic dunning |
| Razorpay Subscriptions (autopay) | Automatic charges, retries, dunning | Extra ~0.99% subscription fee on top of 2% + GST; mandates: UPI AutoPay standard per-debit cap ₹15,000 (Pro yearly ₹19,990 would need card/e-mandate); mandate friction; more states to reconcile |

Fees (Razorpay standard, Nov 2026): 2% platform fee + 18% GST on the fee (≈2.36%),
no setup fee or AMC; Subscriptions add ~0.99%. The engine is gateway-agnostic, so
autopay can be added later behind the same `ingest_gateway_event` path.

### Flow
1. Owner picks plan + cycle → `prepare_saas_checkout` (as the owner) prices it:
   kind, credit, period, GST. Nothing is written.
2. `xs-billing` `start` records the attempt (service role), refuses provisional prices with
   **live** keys, creates a payment link for exactly that amount, returns to `/billing?billing=<id>`.
3. Access changes only in `apply_saas_payment` (service role), after Razorpay says the link is
   paid — from `check` (asks Razorpay's API) or the signed webhook. Amount must match.
4. A paid invoice/receipt is issued in the same transaction.

### Webhook (`xs-billing-webhook`, verify_jwt off)
* HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`, constant-time compare;
  `RAZORPAY_WEBHOOK_SECRET_OLD` accepted during rotation.
* Stored once per `x-razorpay-event-id` (body hash if missing) in `saas_gateway_events`:
  a replay of a processed event does nothing; a failed one is re-processed when Razorpay retries (500).
* Order-safe: a late `payment_link.expired` never undoes a payment; `refund.created` after
  `refund.processed` keeps processed; older dispute events never overwrite newer ones.
* Handles `payment_link.paid|expired|cancelled`, `payment.failed`, `refund.created|processed|failed`,
  `payment.dispute.*`; other products' events are ignored.
* **Test-mode payments** are recorded with a TEST invoice series and do **not** grant access
  unless `test_payments_grant_access` is on (only in test databases).

Reconciliation: admins run **Reconcile with Razorpay** (`xs-billing` `reconcile`): re-checks
unfinished links from the last 14 days, applies paid ones, closes expired ones.

## 5. Invoices and GST
* Numbers per Indian financial year, gapless: `XS/2026-27/0001` (live), `TEST/2026-27/0001` (test).
* `gst_status` is **unconfirmed** by default — documents are "Payment receipt", no tax line.
  When set to `registered` (GSTIN required): tax invoice, CGST+SGST for the supplier's state,
  IGST otherwise (place of supply = customer's state code, default supplier state);
  prices inclusive (default) or exclusive of GST. Rate configurable (18%).
* Customer details (business name, GSTIN, address, state code) from Billing details.
* Refunds and disputes are recorded against the payment and the invoice status
  (partially refunded / refunded). Money is refunded in the Razorpay dashboard.
* **Confirm GST registration, SAC code and invoice wording with a CA before live collections.**

## 6. Xelorsoft admin (`/admin`)
Access: rows in `public.platform_admins` (`owner` — prices, settings, costs; `admin` —
customer adjustments; `viewer` — read). Add one by SQL as the database owner:
```sql
insert into public.platform_admins (user_id, role)
select id, 'owner' from auth.users where email = 'admin@xelorsoft.com';
```
Shows: registered gyms, active / trial / expiring trials / past due / expired / complimentary,
MRR, ARR, plan and state distribution, churn, collections, refunds, failed payments,
disputes, failed webhooks, test payments (separate). Customers: per-gym history,
payments, invoices and audited actions (extend trial, complimentary access with or
without end, end complimentary on a date, set state, record refund). Pricing: versions,
new draft, activate (owner, with approval note). Settings: billing settings and cost model.
Audit: every admin change with before/after. CSV export of subscriptions, payments,
invoices, events. Revenue counts **live** SaaS payments only — never gym member money.

## 7. Cost model and suggested prices (NOT published)

Assumptions in `saas_cost_model` (editable by owners; all marked assumptions):

| Item | Assumed | Notes |
|---|---|---|
| Fixed infrastructure | ₹2,300 / month | Supabase Pro ~$25 (backups) + domain/email; Cloudflare free |
| Infrastructure per gym | ₹20 / month | storage, egress, functions |
| AI/API per gym | Starter ₹0, Growth ₹60, Pro ₹120 / month | Gemini/Groq/Sarvam fair use |
| Payment processing | 2.36% | Razorpay 2% + 18% GST |
| Support per gym | ₹100 / month | ~20 minutes of founder time |
| Acquisition (CAC) | ₹1,500 per new paying gym | demos, travel, ads |
| Fixed overhead | ₹0 | **founder decision** (salaries, office) |

Unit economics at the suggested monthly prices:

| Plan | Price | Variable cost | Contribution / gym | Margin |
|---|---|---|---|---|
| Starter | ₹499 | ₹132 | ₹367 | 74% |
| Growth | ₹999 | ₹204 | ₹795 | 80% |
| Pro | ₹1,999 | ₹287 | ₹1,712 | 86% |

Break-even on fixed infrastructure alone: ~7 Starter or 3 Growth gyms; CAC is paid back
in about 4 months on Starter, 2 on Growth.

Market check (public listings, Nov 2026): MyGymDesk from about ₹829–₹999/month;
Fitnexa ₹999 / ₹2,499 / ₹5,999 + GST; Indian gym software overall roughly
₹1,000–₹25,000/month; basic billing apps from ₹199/month. The founders' goal is a
"Netflix-level" price; Starter at ₹499 meets it, Growth at ₹999 sits at the entry
point of the market. A lower alternative (Starter ₹299 / Growth ₹699 / Pro ₹1,499)
still leaves ~58% / 71% / 81% contribution with these costs — support time is the
cost that dominates at low prices.

Definitions used by the dashboard are returned with the metrics (`admin_commercial_metrics`).
No price increases happen automatically; nothing is published without an owner activating it.

## 8. Tests (run on this branch)
| Suite | What |
|---|---|
| `tests/db/test_subscriptions.sql` | 120+ checks: catalogue, trial and trial abuse, unauthorised plan/role/admin changes, limits, feature gates, checkout kinds and prices, agreed-price renewals, upgrade credit, downgrade scheduling, idempotent and out-of-order webhooks, wrong amounts, test payments, GST maths, invoice numbering, refunds, disputes, failed payments, metrics, PAST_DUE → GRACE → EXPIRED, billing-only mode, invalid transitions, cancel/resume, admin adjustments and audit, export, hand edits of old columns, **member payments/charges/allocations unchanged** |
| `tests/db/test_billing.sql` | the earlier payment-link checks, updated to the new model |
| `tests/db/migration_safety.sh` | production-shaped pilot data: upgrade → rollback → upgrade; no gym/member/money/staff row changes; nobody locked out; paid period kept |
| `tests/billing/billing.check.mjs` | xs-billing + webhook contracts: prices from the database, live keys refuse provisional prices, no keys → honest 503, return-URL allow-list, only Razorpay's word applies a payment, admin-only reconcile/tick, signature (bad, tampered, missing, rotated), event-id dedupe, retry on failure |
| `src/lib/xsAiApproval.test.ts` | XS AI refuses (402) before any model call when the plan lacks it |
| `tests/ui/billing.mjs` | pricing, subscription (trial/paid/expired/past due/pilot), checkout sheet, locked analytics/enquiries, invoice, admin (overview, customers, pricing, refused) at phone and laptop sizes |

## 9. Deploying (needs founder approval — not done)
1. Backup (Supabase Pro, or `pg_dump`), and export `saas_*` tables.
2. Decide §11 items 1–6. Add platform admins (§6).
3. Apply `supabase/migrations/20261119170000_saas_subscriptions.sql` with the Supabase CLI
   (`supabase db push`) or the SQL editor, in one transaction. Then run the security advisors.
4. Deploy Edge Functions `xs-billing`, `xs-billing-webhook`, `xs-ai`.
5. Merge to `main` (CI publishes the app). Older app builds keep working meanwhile
   (legacy columns and the legacy `price` checkout path are kept).
6. Razorpay: test keys first. Webhook URL
   `https://<project>.supabase.co/functions/v1/xs-billing-webhook`, events
   `payment_link.*`, `payment.failed`, `refund.*`, `payment.dispute.*`, secret in
   `RAZORPAY_WEBHOOK_SECRET`. Do a full test purchase in a test database
   (`test_payments_grant_access` on there only).
7. Schedule the clock: `select cron.schedule('xs-billing-tick', '7 * * * *', 'select public.billing_tick()');` (pg_cron).
8. Go live: owner activates the approved price versions (admin → Pricing), sets GST
   settings, then switches to `rzp_live_` keys. Provisional prices can never be paid live.

## 10. Rollback
`supabase/rollback/20261119170000_saas_subscriptions.down.sql` (tested by
`migration_safety.sh`): restores the payment-link model, original `can_write`,
`apply_saas_payment` and `gym_analytics`; drops the new tables and columns. Gym,
member, money and staff rows are untouched; legacy columns already hold the right
access. Export first: invoices, events, refunds and plan versions are removed.
Frontend: redeploy the previous `main` build.

## 11. Founder decisions
1. **Prices** — approve or change the suggested Starter/Growth/Pro prices and yearly discount; activate versions.
2. **Plan split and limits** — members 200/1,000/∞, staff 2/6/20, which features are Growth vs Pro.
3. **Pilot gyms** — they keep complimentary access with no end date until you set one
   (admin → Customers → End complimentary). Choose the date, notice period and any pilot discount.
4. **GST** — registration status, GSTIN, legal name, address, SAC code, inclusive/exclusive prices (confirm with a CA).
5. **Refund policy** — current text: no refunds once a period starts, except where the law requires.
6. **Who is a platform admin**, and with which role.
7. **Payment rail** — prepaid links now (chosen); Razorpay autopay later?
8. **Trial while paying** — the chosen plan's features apply at payment; paid days start after the trial (no days lost). OK?
9. **Phone at sign-up** — make it required to strengthen the one-trial rule?
10. **Expired gyms** — read-only (default) or billing-only.
11. **Reminder delivery** — reminders are queued (`saas_notifications`) and shown in-app; email (Resend) / WhatsApp sending is not built.
12. **Now, independent of this branch** — CHAOS COMBAT and Super Gym lock on 9 Dec under the live rule; extend them or deploy this first.
