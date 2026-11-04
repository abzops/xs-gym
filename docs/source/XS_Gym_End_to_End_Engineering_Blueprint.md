# XS GYM --- End-to-End Product, Engineering & Delivery Blueprint

**Document ID:** XS-GYM-ENG-001\
**Version:** 1.0\
**Status:** Implementation master brief for Codex / engineering agency\
**Product owner:** Xelorsoft\
**Product:** XS Gym\
**Primary pilot:** One real gym (founding customer)\
**Deployment target:** `gym.xelorsoft.com` (subject to domain ownership
and DNS verification)\
**Frontend target:** Responsive installable Progressive Web App (PWA)\
**Backend target:** Supabase\
**AI target:** Provider-independent XS AI Gateway with controlled
fallback\
**Date:** 05 November 2026

------------------------------------------------------------------------

## 0. How to use this document

This is the single source of truth for planning, building, testing,
deploying and handing over XS Gym. Give this file and the existing
Xelorsoft brand-assets folder to Codex. Codex must first inspect the
repository and assets, then create an implementation plan, then execute
in gated phases.

### Mandatory instructions to Codex

1.  **Do not start by generating the whole application in one pass.**
    Inspect the existing project, brand kit, logo, website assets,
    fonts, colours, existing code and deployment setup.
2.  Preserve existing brand assets. Do not invent a new logo, palette or
    typography system when official assets already exist.
3.  Do not overwrite or delete existing files without inspecting them
    and explaining the change.
4.  Create and maintain `docs/` documentation, migrations, tests and a
    changelog as implementation progresses.
5.  Implement in vertical slices. A feature is not complete until UI,
    backend, authorization, validation, error states, tests and
    documentation are complete.
6.  Never expose Supabase `service_role`, LLM provider keys, payment
    secrets or other privileged credentials in browser code, Git
    history, logs or prompts.
7.  Never trust frontend-only subscription checks, role checks, price
    calculations or AI instructions. Enforce security and business rules
    on the server/database.
8.  Never use an LLM to calculate authoritative money totals, membership
    expiry, attendance counts or payment status. Use deterministic
    database logic.
9.  Never claim a payment, renewal, message or database action succeeded
    unless the backend confirms it.
10. Do not use fake/demo data in production. Keep seeded demo data
    clearly separated from real tenant data.
11. Do not add unnecessary paid infrastructure. Prefer free/open-source
    options where they are genuinely safe and maintainable. Clearly mark
    every feature that requires a paid plan, API quota or external
    account.
12. Do not silently downgrade security or testing to meet a deadline.
    Report blockers and propose a safe alternative.
13. Ask the owner only for secrets, account access, domain/DNS details,
    brand decisions or business rules that cannot be inferred. Never ask
    the owner to paste secrets into chat; use local environment files or
    secret managers.
14. Before production deployment, provide a written release report, test
    results, known limitations, backup/restore evidence and rollback
    instructions.

### Completion standard

The project is complete only when: - the application works on phone,
portrait tablet, landscape tablet and laptop/desktop; - all core
workflows work against the real Supabase backend; - tenant isolation and
role permissions are tested; - payment and membership calculations pass
automated tests; - the 30-day trial and paid-plan enforcement are
server-side; - voice interaction has clear permission, fallback and
error behaviour; - performance and accessibility checks pass the agreed
thresholds; - the pilot gym owner has completed UAT; - deployment,
backups, monitoring, documentation and handover are complete.

------------------------------------------------------------------------

# 1. Product vision and positioning

## 1.1 Product definition

**XS Gym** is a mobile-first, tablet-friendly and desktop-ready Gym
Management SaaS product by Xelorsoft. It should help a gym operate its
daily business from one simple application: members, memberships,
attendance, collections, expenses, trainers, workout plans,
communication, reports and an AI voice assistant.

It is not merely a dashboard or chatbot. It is an operational system
with reliable records, permissions, audit history and controlled
actions.

## 1.2 Product promise

> Run your gym simply. Know your numbers accurately. Get routine work
> done faster with AI.

## 1.3 Product principles

-   **Mobile first, not mobile only.**
-   **Fast by default:** common actions should take as few taps as
    possible.
-   **Accuracy before decoration:** money, membership dates and
    attendance must be correct.
-   **Simple for non-technical staff:** clear labels, large controls,
    minimal typing.
-   **Malayalam-friendly:** support Malayalam, English and Manglish
    input where technically feasible.
-   **Progressive disclosure:** show the essential action first; keep
    advanced settings available but not overwhelming.
-   **Human approval for consequential actions:** payments, bulk
    messages, destructive operations and sensitive changes require
    confirmation.
-   **Tenant isolation:** one gym must never access another gym's data.
-   **Portable customer data:** customers can export their records;
    expiry must not destroy data.
-   **Low operating cost:** start lean, measure actual usage, scale only
    when justified.
-   **No false AI certainty:** show when the AI does not know or cannot
    safely complete an action.

## 1.4 Target users

1.  Gym owner / business owner.
2.  Gym manager.
3.  Receptionist / front-desk staff.
4.  Trainer.
5.  Member (optional member portal, later release).
6.  Xelorsoft super administrator (platform operations only; restricted
    and audited).

## 1.5 Multi-tenant product from day one

The first gym is the founding pilot tenant, not a one-off hard-coded
installation. Build one SaaS application where each gym has an isolated
workspace. A second gym must be onboarded through configuration and
tenant setup, not by copying the codebase.

------------------------------------------------------------------------

# 2. Scope: what the product should do

Use the labels below: - **P0 --- Pilot critical:** required before the
first gym goes live. - **P1 --- Important:** build after P0 is stable,
or include if the pilot explicitly needs it. - **P2 --- Later
expansion:** design for extension but do not block launch.

## 2.1 Core dashboard

**P0** - Active members. - Members expiring today / in the next 7 days /
in the next 30 days. - Today's attendance count. - Today's
collections. - Month-to-date collections. - Outstanding dues. - Quick
actions: Add Member, Check In, Record Payment, Add Expense, Search
Member. - Recent activity feed. - Clear date range and timezone
context. - Loading, empty, error and offline states.

**P1** - Revenue trend, membership growth, attendance trend. - Plan-wise
member distribution. - Trainer activity. - Renewal conversion and
retention indicators.

Dashboard numbers must be derived from documented database queries or
views. Define every metric precisely. For example, "collection" means
successful recorded payments within the selected date range, not
invoices created or pending dues.

## 2.2 Member management

**P0** - Create, view, edit, archive and search member. - Member ID
generated by the backend. - Name, phone, email (optional), photo
(optional), date of birth (optional), gender (optional), address
(optional), emergency contact (optional). - Join date. - Membership
status and current plan. - Notes with restricted access. - Member
profile timeline: membership changes, attendance, payments, notes and
relevant communication. - Duplicate detection using normalized phone
number and gym scope. - Search by name, phone, member ID and status. -
CSV import with preview, validation and duplicate report. - CSV export
subject to permission.

**P1** - QR member card. - Member self-service profile. - Consent and
communication preferences. - Multiple contact numbers. - Member tags and
segments.

Do not collect medical history, injury information or body measurements
unless the gym has a clear lawful purpose, explicit consent, access
controls and a documented retention policy. Keep sensitive health data
out of AI prompts by default.

## 2.3 Membership plans and subscriptions

**P0** - Configurable plan name, duration, price, description and
status. - Duration options: 1 month, 3 months, 6 months, 12 months and
custom duration. - Start date and end date. - Membership activation,
renewal, freeze/hold (if policy permits), cancellation and expiry. -
Renewal history. - Discount amount and reason with permission. - Grace
period configured by gym owner. - Expiry reminders. - Proration policy
must be explicitly defined; do not invent it. - Handle month-end dates
correctly (e.g. 31 January + one calendar month). - Use date-only values
for membership dates and `Asia/Kolkata` for display and business-day
boundaries.

**P1** - Family / group memberships. - Personal training add-ons. -
Membership pause with start/end and audit trail. - Referral discount and
coupon. - Auto-renewal only after payment provider and explicit customer
consent are implemented.

Membership state must be computed consistently. Do not use browser
clocks as the authority.

## 2.4 Attendance

**P0** - Fast front-desk check-in by member ID, phone or name search. -
Check-in timestamp from server. - Prevent accidental duplicate check-ins
according to gym policy. - Show member membership status before
check-in. - Configurable handling of expired or frozen members: warn,
block or manager override. - Daily attendance list and member attendance
history. - Manual correction requires permission and reason; preserve
original event in audit log.

**P1** - QR code scanning. - Kiosk mode. - Member self-check-in. -
Optional check-out. - Attendance analytics.

Do not make biometric integration a P0 dependency. It introduces
hardware, privacy, integration and cost complexity.

## 2.5 Payments, dues and receipts

**P0** - Record cash, UPI and other configured payment methods. -
Payment amount, currency INR, date/time, member, purpose, reference,
received-by user and notes. - Partial payments. - Outstanding balance
calculation. - Payment history and printable/shareable receipt. -
Reversal/refund as a separate audited transaction; do not silently edit
or delete a successful payment. - Daily collection report and date-range
report. - Payment reconciliation view. - Manual UPI recording must be
clearly labelled as manually verified; do not imply automatic bank
verification.

**P1** - Payment gateway integration (only after merchant account, fees,
webhooks and reconciliation are approved). - Payment links. - Automated
receipts. - Refund workflow.

### Financial correctness rules

-   Store currency as integer paise (`BIGINT`) or use an explicitly safe
    decimal type. Never use JavaScript floating-point numbers for money
    arithmetic.
-   Use `INR` as the initial currency.
-   All authoritative calculations happen in Postgres functions/queries
    or trusted server-side code.
-   Every payment mutation must be transactional.
-   Use idempotency keys for retry-safe payment creation.
-   Unique external payment references where available.
-   Preserve immutable transaction history. Corrections use
    reversal/adjustment records.
-   Define revenue, collection, dues, discounts and refunds separately.
-   Reconcile report totals against raw transaction rows in automated
    tests.
-   Never allow an LLM to create or modify a financial transaction
    without structured validation and explicit user confirmation.

## 2.6 Expenses and cashbook

**P0** - Record expense: category, amount, date, payment method,
description, attachment (optional), recorded-by. - Expense categories
configurable by owner. - Daily expense list and date-range report. -
Cashbook view: collections and expenses, clearly distinguishing cash
from UPI/non-cash. - Edit/correction permission and audit log.

**P1** - Supplier/vendor records. - Recurring expenses. - Expense
attachment OCR (optional; AI-extracted values require human
confirmation).

## 2.7 Trainers and staff

**P0** - Staff profiles. - Role and permissions. - Trainer assignment to
members (if required by pilot). - Active/inactive status. - Basic
schedule.

**P1** - Trainer availability and booking. - Trainer performance
indicators. - Commission rules only after the gym confirms its
calculation policy.

## 2.8 Workout and fitness features

**P1** - Exercise library: name, muscle group, equipment, instructions,
media URL. - Workout templates. - Member-specific workout plan. - Sets,
reps, duration, rest interval and notes. - Plan start/end date and
assigned trainer. - Progress notes. - Trainer approval and revision
history.

**P2** - Member workout logging. - Exercise demonstration videos. -
Progress charts. - Wearable integrations.

AI-generated workouts must be presented as suggestions, not medical
advice. A qualified trainer should review plans. Do not generate
high-risk recommendations from incomplete health information.

## 2.9 Diet and nutrition

**P1/P2** - Basic trainer-entered diet notes or meal plan. -
Allergen/diet preference fields only when needed and consented. - AI may
explain general nutrition concepts but must not diagnose, prescribe
treatment or replace a qualified professional. - Keep health-related
data out of the AI provider unless a reviewed privacy and provider
agreement explicitly permits it.

## 2.10 Notifications and communication

**P0** - In-app notification centre. - Membership expiry alerts for
staff. - Payment due reminders. - Notification log and delivery
status. - Configurable templates.

**P1** - Email provider integration. - WhatsApp Business Platform
integration after business verification, template approval, consent,
pricing review and webhook implementation. - Bulk campaigns with
preview, recipient count, opt-out/consent checks and explicit approval.

Do not scrape WhatsApp Web or automate personal WhatsApp accounts. Use
supported official APIs.

## 2.11 Reports and exports

**P0** - Daily collections. - Monthly collections. - Expenses. -
Outstanding dues. - Membership expiry list. - New members. -
Attendance. - Payment history. - CSV export with permission.

**P1** - PDF reports. - Plan performance. - Renewal/retention trends. -
Cohort and attendance insights.

Every report must show filters, date range, timezone and metric
definition. Reports must be reproducible from source records.

## 2.12 Audit trail

**P0** Record important events: - Login/security events where
appropriate. - Member create/update/archive. - Membership
create/renew/freeze/cancel. - Payment create/reversal. - Expense
create/update. - Attendance correction. - Role/permission change. -
Subscription plan change. - AI-triggered action, requesting user, tool
name, validated arguments, approval and result.

Audit logs must be append-only for application users. Restrict access to
owners and authorized administrators.

------------------------------------------------------------------------

# 3. Responsive UX: mobile, tablet portrait, tablet landscape and desktop

This is a core acceptance requirement, not a later polish task.

## 3.1 Device modes

The same product must adapt to: - Small mobile phones. - Large phones. -
Tablet portrait. - Tablet landscape. - Laptop. - Desktop / large
monitor.

Do not detect device type by user-agent. Use responsive layout based on
available viewport width, orientation and container space.

## 3.2 Suggested responsive behaviour

Use CSS breakpoints as starting points, then validate against real
devices. Breakpoints are not rigid device categories.

  ---------------------------------------------------------------------------
  Layout mode       Approximate viewport Navigation       Content
  ---------------- --------------------- ---------------- -------------------
  Compact mobile             below 640px Bottom           Single column,
                                         navigation +     cards, full-screen
                                         compact top bar  forms

  Large mobile                640--767px Bottom           Single/two-column
                                         navigation or    where comfortable
                                         compact rail     

  Tablet portrait             768--899px Collapsible      Single/two-column
                                         navigation /     dashboard; tables
                                         bottom bar       become cards or
                                                          scroll safely

  Tablet landscape           900--1199px Side navigation  Desktop-like
                                                          two-column
                                                          workspace

  Laptop                    1200--1439px Persistent       Multi-column
                                         sidebar          dashboard and full
                                                          tables

  Large desktop                  1440px+ Persistent       Wider layout with
                                         sidebar          max content width
  ---------------------------------------------------------------------------

The application must also adapt when the tablet rotates. A portrait
tablet should feel like a tablet/mobile hybrid; a landscape tablet
should use the available width like a compact laptop.

## 3.3 Mobile UX requirements

-   Primary actions reachable with one hand where practical.
-   Minimum touch target 44×44 CSS px; prefer 48×48 for primary actions.
-   Sticky primary action on long forms where useful.
-   No tiny icon-only controls without accessible labels.
-   Numeric keypad for phone, amount and numeric fields.
-   Input masks and inline validation.
-   Avoid horizontal page overflow.
-   Tables should transform into readable cards or use a deliberately
    scrollable table region with visible affordance.
-   Do not shrink desktop tables until text becomes unreadable.
-   Use bottom sheets or full-screen dialogs on mobile.
-   Confirm destructive actions.
-   Keep the main check-in and payment flows extremely short.
-   Use skeleton loading, optimistic UI only for reversible actions, and
    clear error recovery.
-   Never optimistically show a payment as completed before server
    confirmation.

## 3.4 Tablet UX requirements

-   Portrait: compact navigation, cards and focused forms.
-   Landscape: sidebar and wider tables, two-panel workflows where
    useful.
-   Support touch and keyboard/mouse.
-   No fixed-width layout that breaks between portrait and landscape.
-   Recalculate layout on resize/orientation change without losing form
    state.

## 3.5 Desktop UX requirements

-   Persistent sidebar.
-   Keyboard navigation and shortcuts for front-desk operations.
-   Dense data tables with search, sorting and pagination.
-   Multi-panel details where appropriate.
-   Avoid excessive empty space or over-wide text lines.

## 3.6 Design system

Inspect the provided Xelorsoft brand kit first. Extract: - Logo variants
and clear-space rules. - Primary/secondary/accent colours. - Typography
and font files/licensing. - Icon style. - Radius, border, spacing and
component conventions. - Photography/illustration rules.

Create tokens in CSS variables. Use semantic tokens (`--color-primary`,
`--surface`, `--text`, `--success`, `--danger`) rather than hard-coded
values throughout components.

If no gym-specific visual identity exists, use the Xelorsoft product
identity as the base and create a restrained XS Gym application theme.
Do not redesign the corporate brand.

Accessibility: - WCAG 2.2 AA target for key workflows. - Keyboard
support. - Visible focus. - Labels and error associations. - Sufficient
contrast. - Reduced-motion support. - Screen-reader status
announcements. - Accessible charts with text summaries.

------------------------------------------------------------------------

# 4. Performance and responsiveness targets

The user expects the application to feel extremely fast. Treat speed as
an engineering requirement.

## 4.1 Experience targets

Targets for a representative mid-range Android device and normal
4G/Wi-Fi: - Initial useful screen: target under 2.5 seconds on a
warm/typical connection. - Common navigation: target under 300 ms for
local transitions. - Search feedback: target under 200 ms for local UI
feedback; server results should stream/render as soon as available. -
Common database reads: target p95 under 500 ms when backend and network
are healthy. - Check-in/payment form interaction: no visible blocking
during typing. - Avoid large blocking bundles. - Lazy-load non-critical
modules and charts. - Keep animations short and purposeful; never
animate at the cost of interaction latency.

These are targets, not guarantees. Measure on real devices and network
conditions. Record baseline and regressions.

## 4.2 Frontend performance

-   Use Vite production build.
-   Route-level code splitting.
-   Lazy-load heavy reports, charts and admin screens.
-   Use image resizing/compression and modern formats.
-   Avoid unnecessary global state and re-render cascades.
-   Use server pagination for large lists.
-   Debounce search appropriately.
-   Cache safe read-only data with TanStack Query or a similarly
    maintained data-fetching layer.
-   Do not cache sensitive data indefinitely.
-   Use list virtualization only when real dataset size justifies it.
-   Avoid overusing animation libraries.
-   Monitor bundle size in CI.

## 4.3 Network and offline behaviour

PWA offline support should be conservative: - Cache application shell
and static assets. - Show a clear offline indicator. - Allow safe
read-only cached screens only where data freshness is labelled. - Do not
queue financial mutations or attendance actions silently unless an
explicit, tested offline transaction design exists. - If offline write
queue is implemented, use unique client-generated operation IDs,
idempotency, conflict handling, visible pending state and explicit sync
results. - Never claim a queued payment was collected. - Do not cache
auth tokens or private member records in an unsafe service-worker
cache. - Provide a visible "last synced" timestamp.

## 4.4 Monitoring

Track: - Web Vitals (LCP, INP, CLS). - API latency and error rate. -
Supabase query latency where observable. - JavaScript errors. - Failed
logins. - AI provider latency and failure. - Voice permission and
connection failures. - Usage and quota consumption.

Avoid logging raw voice recordings, secrets, full member profiles or
payment data.

------------------------------------------------------------------------

# 5. Recommended technical architecture

## 5.1 Architecture overview

``` text
Phone / Tablet / Laptop / Desktop
              |
       Responsive PWA
      React + TypeScript
              |
      Supabase Auth session
              |
       Supabase Edge Functions
        /        |         \
       /         |          \
  Business API  XS AI       Webhooks
  & validation  Gateway     (payment etc.)
       |          |
       |     Provider adapters
       |     Gemini / Groq /
       |     OpenRouter / other
       |          |
       |     Tool authorization
       |          |
       +-------> Approved tools
              |
        PostgreSQL + RLS
              |
       Storage / audit / views
```

## 5.2 Recommended stack

### Frontend

-   React + TypeScript + Vite.
-   React Router (or a well-supported routing alternative).
-   Tailwind CSS if compatible with the supplied design system;
    otherwise CSS Modules or existing project styling.
-   Accessible component primitives; use shadcn/ui selectively, not as a
    reason to rebuild the entire visual system.
-   `@supabase/supabase-js`.
-   TanStack Query for server state.
-   React Hook Form + Zod for validated forms.
-   `date-fns` for date handling; enforce timezone/date-only semantics
    carefully.
-   `lucide-react` for consistent icons.
-   Recharts only for reports that genuinely need charts.
-   `vite-plugin-pwa` for PWA support.
-   `sonner` or an accessible toast system for non-blocking feedback.

### Backend

-   Supabase PostgreSQL.
-   Supabase Auth.
-   Supabase Storage for member photos and permitted documents.
-   Supabase Edge Functions for trusted server actions, AI gateway,
    webhooks and subscription checks.
-   Postgres functions/triggers only when logic belongs in the database
    and can be tested.
-   Supabase CLI for migrations and local development.

### Testing

-   Vitest.
-   React Testing Library.
-   Playwright.
-   `@axe-core/playwright` for accessibility checks.
-   Zod schemas shared where appropriate.
-   SQL migration tests and RLS tests.
-   Manual UAT on real phone, portrait tablet, landscape tablet and
    laptop.

### Deployment

-   GitHub repository.
-   GitHub Actions CI.
-   GitHub Pages only for static frontend hosting if its constraints fit
    the app.
-   Custom domain `gym.xelorsoft.com` after DNS and domain ownership
    verification.
-   Supabase hosted backend.
-   If SPA routing causes GitHub Pages 404 issues, configure a supported
    fallback/hash strategy and test deep links. Do not assume every
    hosting feature is available.

## 5.3 Hosting caveats

GitHub Pages hosts static frontend assets. It does not run a private
Node server, persistent background worker, database or secret-bearing
API backend. Do not put server logic or API keys into the static bundle.

Supabase Free is useful for pilot development, but it has quotas,
inactivity/pause and backup limitations that must be reviewed at launch.
Free projects do not receive automatic daily database backups; export
and store backups separately. Before production, agree on backup
frequency, restore procedure and acceptable data-loss window.

A custom Supabase API domain is a separate paid add-on; it is not
required for the initial app domain. Keep the Supabase default API URL
in environment configuration unless a paid custom API domain is
deliberately purchased.

------------------------------------------------------------------------

# 6. Repository and project structure

Use a clear structure. Adapt only after inspecting existing code.

``` text
xs-gym/
├── public/
│   ├── icons/
│   ├── manifest.webmanifest
│   └── assets/
├── src/
│   ├── app/
│   │   ├── router/
│   │   ├── providers/
│   │   └── layouts/
│   ├── components/
│   │   ├── ui/
│   │   ├── forms/
│   │   ├── data-display/
│   │   └── feedback/
│   ├── features/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── members/
│   │   ├── memberships/
│   │   ├── attendance/
│   │   ├── payments/
│   │   ├── expenses/
│   │   ├── trainers/
│   │   ├── workouts/
│   │   ├── diet/
│   │   ├── reports/
│   │   ├── notifications/
│   │   ├── voice-assistant/
│   │   ├── ai-chat/
│   │   └── platform-subscription/
│   ├── lib/
│   │   ├── supabase/
│   │   ├── validation/
│   │   ├── dates/
│   │   ├── money/
│   │   ├── permissions/
│   │   └── telemetry/
│   ├── hooks/
│   ├── styles/
│   ├── types/
│   └── main.tsx
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── functions/
│   │   ├── ai-chat/
│   │   ├── ai-voice-session/
│   │   ├── execute-gym-action/
│   │   ├── subscription-status/
│   │   ├── payment-webhook/
│   │   └── notification-dispatch/
│   └── seed.sql
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── security/
│   └── fixtures/
├── docs/
│   ├── PRODUCT_REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── SECURITY.md
│   ├── AI_AND_VOICE.md
│   ├── TEST_PLAN.md
│   ├── DEPLOYMENT.md
│   ├── BACKUP_RESTORE.md
│   ├── RUNBOOK.md
│   └── DECISIONS/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── CHANGELOG.md
```

Do not commit `.env`, `.env.local`, service-role keys, provider keys,
payment secrets, database dumps containing personal data or real member
exports.

------------------------------------------------------------------------

# 7. Database design

Codex must produce an ERD and migration plan before implementing all
tables. The following is the logical model, not permission to skip
schema review.

## 7.1 Platform and identity tables

### `gyms`

-   `id UUID PRIMARY KEY`
-   `name`
-   `slug`
-   `timezone` default `Asia/Kolkata`
-   `currency` default `INR`
-   `phone`, `email`, `address` (optional)
-   `logo_path` (optional)
-   `status`
-   `created_at`, `updated_at`

### `profiles`

-   `id UUID PRIMARY KEY` linked to `auth.users`
-   `display_name`
-   `phone`
-   `avatar_path`
-   `created_at`, `updated_at`

### `gym_memberships` (staff access to a tenant)

-   `id`
-   `gym_id`
-   `user_id`
-   `role`
-   `status`
-   `created_at`
-   Unique `(gym_id, user_id)`

A user may belong to more than one gym only if product policy allows it.
All access must be tenant-scoped.

### `roles` / `permissions`

Use either normalized role-permission tables or a carefully validated
permission map. Do not rely on role names alone in the UI.

## 7.2 Gym operations tables

-   `members`
-   `membership_plans`
-   `member_memberships`
-   `membership_events`
-   `attendance_events`
-   `payments`
-   `payment_reversals`
-   `expenses`
-   `expense_categories`
-   `trainers`
-   `trainer_assignments`
-   `exercise_library`
-   `workout_plans`
-   `workout_plan_items`
-   `diet_plans` (only if approved)
-   `notifications`
-   `notification_templates`
-   `communication_consents`
-   `audit_logs`

Every tenant-owned row must contain `gym_id`, with a foreign key and
tenant-consistent constraints. Index `gym_id` plus common filters,
e.g. `(gym_id, status)`, `(gym_id, created_at)`, `(gym_id, member_id)`.

## 7.3 Subscription tables

Keep **Xelorsoft SaaS subscription** separate from **gym member
memberships**. These are two different billing domains.

-   `saas_plans`: Starter, Growth, MAX, trial configuration.
-   `gym_subscriptions`: tenant's subscription to XS Gym.
-   `saas_subscription_events`: trial started, trial expired, plan
    changed, payment verified, grace period, suspended.
-   `saas_payments`: payment transactions for Xelorsoft subscription.
-   `feature_entitlements`: plan-to-feature and usage limits.

The pilot trial is 30 calendar days from the server-recorded activation
timestamp. Store `trial_started_at` and `trial_ends_at` as
`TIMESTAMPTZ`; calculate in one authoritative server-side function.
Define whether the exact end moment is inclusive/exclusive. Recommended:
access is valid while `now() < trial_ends_at`; expired at or after the
timestamp.

## 7.4 AI and usage tables

-   `ai_conversations`
-   `ai_messages` (avoid storing raw audio by default)
-   `ai_tool_calls`
-   `ai_provider_usage`
-   `ai_provider_health` (optional operational telemetry)
-   `ai_user_preferences`
-   `voice_session_events` (metadata only)

Apply retention limits. Do not retain raw recordings unless an explicit
product requirement, consent and retention policy exist.

## 7.5 Database constraints

-   Foreign keys for all relationships.
-   Unique constraints for tenant-scoped identifiers.
-   Check constraints for positive amounts and valid states.
-   Use enums or constrained text for status fields.
-   Use `created_at`, `updated_at`; maintain `updated_at` consistently.
-   Store money in paise or safe decimal, never floating point.
-   Use UTC timestamps; render in tenant timezone.
-   Use date-only columns for membership calendar dates where
    appropriate.
-   Do not hard-delete financial or audit records.
-   Avoid cascade deletes for important business records.
-   Use transactions for multi-step actions.

------------------------------------------------------------------------

# 8. Security, privacy and authorization

Security is a launch blocker, not a later enhancement.

## 8.1 Authentication

-   Supabase Auth.
-   Email/password or magic link depending on pilot preference.
-   Secure password reset.
-   Session refresh and sign-out.
-   Optional MFA for owner/super admin as a later hardening step.
-   Never trust a user ID or gym ID sent by the browser without
    verifying the authenticated user's membership and permission.

## 8.2 Row Level Security

Enable RLS on every tenant-owned table. Default-deny. Write explicit
policies for SELECT, INSERT, UPDATE and DELETE (where delete is
permitted).

Security requirements: - A user can access a gym only through a valid
`gym_memberships` row. - `gym_id` must be derived/validated server-side
for privileged operations. - Staff can access only assigned/allowed
modules. - Trainer access must be limited to assigned members where
applicable. - Members can access only their own permitted data. -
Super-admin access must be separate, minimal, audited and never a hidden
bypass in ordinary user sessions. - Test cross-tenant access with at
least two separate test gyms and users. - Do not rely on obscurity,
route guards or hidden UI controls.

## 8.3 Secrets

-   Frontend may contain only public Supabase URL and publishable/anon
    key.
-   Supabase service-role key is server-side only.
-   AI keys, payment secrets and webhook secrets are server-side only.
-   Use Supabase Edge Function secrets or an appropriate secret manager.
-   `.env.example` contains placeholders only.
-   Rotate any key accidentally committed; deleting the file in a later
    commit does not make the key safe.
-   Redact secrets and personal data from logs.

## 8.4 Privacy

-   Collect only information necessary for gym operations.
-   Explain purpose and access for member data.
-   Define retention, export and deletion policies.
-   Restrict photos and documents using private storage buckets and
    signed URLs.
-   Do not expose public storage URLs for private member records.
-   Do not send member health information, payment details or contact
    lists to third-party AI services by default.
-   Add consent controls for WhatsApp/email communication.
-   Review applicable Indian privacy and consumer obligations with
    qualified counsel before commercial scale; this document is not
    legal advice.

## 8.5 Threat modelling

Document mitigations for: - Broken access control. - Cross-tenant data
leakage. - IDOR. - XSS and unsafe HTML. - CSRF where applicable. - SQL
injection (use parameterized queries). - Credential leakage. -
Brute-force login. - Webhook forgery/replay. - Payment duplication. -
Prompt injection. - AI tool abuse. - Sensitive data leakage through logs
or model providers. - Malicious file upload. - Insecure exports. -
Backup exposure.

------------------------------------------------------------------------

# 9. XS AI Gateway --- provider-independent LLM routing

## 9.1 Purpose

Create one internal AI interface so the product does not depend on a
single model provider. The gateway should select a suitable model based
on task, availability, latency, privacy constraints, quota and cost.

Do not assume that "free model" means unlimited, stable, private or
suitable for production. Free tiers change and may have data-use
conditions.

## 9.2 Suggested initial provider order

Treat this as configurable, not hard-coded: 1. Primary: a currently
available Gemini API model suitable for tool calling. 2. Secondary: a
currently available Groq-hosted model suitable for the task. 3.
Tertiary: an eligible OpenRouter free model with tool support. 4.
Additional provider only after verifying current terms, capability and
quotas.

The model list must be checked at implementation time. Model IDs, free
quotas, rate limits, context windows and tool-calling support change
frequently.

## 9.3 Gateway requirements

-   Provider adapter interface.
-   Central model registry and capability metadata.
-   Separate routing policies for chat, structured extraction, voice
    response and tool calling.
-   Health and rate-limit tracking.
-   Bounded retry with exponential backoff and jitter.
-   Circuit breaker for unhealthy providers.
-   Provider/model cooldown after 429 or repeated failures.
-   Per-gym and per-user quotas.
-   Usage accounting by provider, model, input/output tokens and request
    type.
-   Timeout and maximum output limits.
-   Structured JSON schema validation for tool arguments.
-   Clear error when all providers fail.
-   Never silently change to a model that cannot support the requested
    tool or privacy requirement.
-   Do not retry non-idempotent actions automatically.
-   Keep secrets in server-side environment only.
-   Redact sensitive context before external model calls.
-   Log provider metadata, not raw private prompts by default.

## 9.4 Retry/fallback policy

-   Retry only transient errors: 429, selected 5xx, network timeout.
-   Respect `Retry-After` where supplied.
-   Do not retry 400 invalid request, 401/403 auth or policy errors
    without configuration correction.
-   On provider failure before a tool action, fallback may be attempted.
-   Once an action has been executed, do not rerun it merely because
    response generation failed. Use an idempotency key and action status
    lookup.
-   If fallback changes model capability, revalidate tool schema and
    safety.
-   Avoid parallel fan-out to multiple free providers for the same user
    request; it wastes quota and may duplicate data exposure.

## 9.5 Recommended implementation options

Choose one approach after a small proof of concept:

**Option A --- Vercel AI SDK** - Strong fit for a TypeScript
application. - Provider adapters and structured tool calling. - AI
Gateway can provide provider routing/fallback, but is an external
managed service and may have cost/terms. Do not assume its gateway
service is free. - Keep gateway calls server-side.

**Option B --- LiteLLM** - Open-source Python proxy/SDK with a unified
provider interface and routing/fallback. - More operational overhead if
self-hosted. - It needs a server/container environment; GitHub Pages
cannot host it. - Use only if a suitable backend host and maintenance
plan exist.

**Option C --- Small custom Edge Function gateway** - Best lean starting
point for a Supabase-first project with a few providers. - Implement a
strict adapter interface, timeouts, retry policy, quotas and structured
output validation. - Avoid building a general-purpose gateway platform.

Recommended initial approach: **Option C** for the pilot, with provider
adapters designed so the application can migrate to LiteLLM or another
gateway later. Do not deploy a separate always-on gateway server just to
save a small amount of code.

------------------------------------------------------------------------

# 10. XS Gym Voice AI

## 10.1 Product experience

A visible microphone/voice button should be available from the main app
shell for authorized users. On activation: - open a polished voice
overlay or full-screen voice view; - request microphone permission only
when needed; - show clear states: Idle, Connecting, Listening,
Processing, Speaking, Action confirmation, Error; - animate a restrained
audio orb/waveform; - show live transcript where supported; - allow
interruption/stop; - allow switching to text; - provide spoken response
and readable text transcript; - support Malayalam, English and Manglish
to the extent supported by selected STT/TTS providers; - show network
and microphone permission errors clearly; - preserve the user's ability
to cancel before a consequential action.

## 10.2 Voice architecture

Separate these components: 1. Microphone capture and permission. 2.
Voice activity detection (if provider supports it). 3. Speech-to-text
(STT). 4. Conversation orchestration. 5. Tool calling and authorization.
6. Text-to-speech (TTS). 7. Streaming playback and interruption. 8.
Transcript and action history.

Browser Web Speech APIs can be a no-cost prototype/fallback, but browser
support, language accuracy, privacy behaviour and availability vary. Do
not make them the only production voice architecture.

For a production-grade low-latency voice experience, evaluate a realtime
speech service or a managed STT + LLM + TTS pipeline. Verify pricing,
quotas, supported Malayalam locale/voice quality, browser support, data
retention and terms before selecting. Keep provider interfaces
replaceable.

## 10.3 Voice UX rules

-   Push-to-talk is the reliable initial mode.
-   Do not enable always-listening by default.
-   Make recording/listening status unmistakable.
-   Do not store raw audio by default.
-   Allow transcript correction before a write action.
-   For ambiguous names or amounts, ask a follow-up.
-   Read back important amounts, dates and member names.
-   Provide a confirmation card before payments, bulk messaging,
    membership changes or destructive actions.
-   Do not execute a high-impact action from a low-confidence
    transcript.
-   Support text fallback if voice is unavailable.

## 10.4 Voice examples

Owner: "ഇന്ന് എത്ര പേർ gym-ൽ വന്നു?"\
Assistant: "ഇന്ന് 42 check-ins രേഖപ്പെടുത്തിയിട്ടുണ്ട്."

Owner: "അടുത്ത ഏഴ് ദിവസത്തിനുള്ളിൽ expire ചെയ്യുന്ന memberships കാണിക്ക്."\
Assistant: "7 ദിവസത്തിനുള്ളിൽ 12 memberships expire ചെയ്യും. ലിസ്റ്റ് തുറക്കട്ടേ?"

Owner: "രാഹുലിന്റെ membership renew ചെയ്യണം."\
Assistant: "രാഹുൽ എന്ന പേരിൽ രണ്ട് members ഉണ്ട്. Phone അവസാന നാല് അക്കങ്ങൾ
പറയാമോ?"

Owner: "അവന്റെ membership ഒരു മാസം renew ചെയ്യൂ."\
Assistant: "₹1,000, ഒരു മാസം. ഇത് confirm ചെയ്യട്ടേ?"\
Only after confirmation and server validation may the renewal be
created.

Owner: "ഇന്ന് 500 രൂപ cash expense ആയി ചേർക്കൂ."\
Assistant: "Expense category എന്താണ്?"\
After details: "₹500 cash expense --- Electricity. Save ചെയ്യട്ടേ?"

## 10.5 AI tool catalogue

Create typed, server-authorized tools such as: - `search_members` -
`get_member_profile` - `get_dashboard_summary` -
`get_attendance_summary` - `get_expiring_memberships` -
`get_pending_dues` - `get_collection_report` - `get_expense_report` -
`prepare_member_registration` - `create_member` (confirmation
required) - `prepare_membership_renewal` - `renew_membership`
(confirmation required) - `prepare_payment_record` - `record_payment`
(confirmation required) - `prepare_expense_record` - `record_expense`
(confirmation required) - `prepare_notification_campaign` -
`send_notification_campaign` (explicit approval required) -
`create_workout_draft` (trainer review) - `get_trainer_schedule`

Each tool must: - validate schema server-side; - verify authenticated
user and tenant; - check role permission; - validate business rules; -
require confirmation where specified; - use idempotency for writes; -
write audit log; - return structured result; - never accept arbitrary
SQL or unrestricted code from the LLM.

The LLM must not have direct database credentials or unrestricted SQL
execution.

------------------------------------------------------------------------

# 11. SaaS subscription, 30-day MAX trial and entitlements

## 11.1 Important separation

There are two separate subscription systems: 1. Gym members' memberships
(gym customer pays the gym). 2. The gym owner's XS Gym SaaS subscription
(gym pays Xelorsoft).

Never mix these tables or calculations.

## 11.2 Founding gym offer

-   One-time 30-day trial.
-   MAX feature access during the trial.
-   Trial begins when the Xelorsoft admin activates the tenant, not
    merely when a staff account is created.
-   Store activation and expiry server-side.
-   Prevent repeated trials by the same tenant through a unique tenant
    subscription history and admin audit.
-   Show remaining trial time and expiry date.
-   Notify owner before expiry (e.g. 7 days, 3 days, 1 day), subject to
    configured notification channels.
-   At expiry, switch to expired entitlement state automatically when
    checked; do not depend on a browser timer.
-   Block paid features server-side.
-   Keep billing, support and data export available.
-   Do not delete tenant data at expiry.
-   Provide a clear upgrade route.
-   Allow a documented grace period only if Xelorsoft explicitly chooses
    one; do not silently invent one.

## 11.3 Suggested initial pricing (not final)

-   Starter: ₹299/month.
-   Growth: ₹599/month.
-   MAX: ₹999/month.

These are hypotheses for customer validation, not a commitment. Confirm
gym size, support needs, infrastructure cost and feature usage before
publishing. Monthly option should remain available. Annual discount can
be optional, never forced.

## 11.4 Entitlements

Do not scatter plan-name conditionals across UI. Use a centralized
entitlement service: - feature key; - plan access; - usage limit; -
effective start/end; - trial override; - server-side enforcement.

Examples: - `members.manage` - `attendance.manage` - `payments.manage` -
`reports.advanced` - `ai.chat` - `ai.voice_minutes` -
`notifications.bulk` - `workouts.manage` - `multi_branch`

## 11.5 Payment integration

For initial pilot, Xelorsoft may manually verify a bank/UPI payment and
activate the subscription through a restricted admin workflow. Label it
as manually verified.

When adding a payment gateway: - verify webhook signature; - handle
retries and duplicate events idempotently; - verify amount, currency,
order and subscription; - do not trust browser success redirect; -
maintain transaction ledger; - test refunds and failed payments; -
disclose fees and renewal rules.

------------------------------------------------------------------------

# 12. Authentication, roles and permissions matrix

Implement least privilege.

  -------------------------------------------------------------------------------------
  Capability           Owner       Manager       Receptionist      Trainer       Member
  ------------- ------------ ------------- ------------------ ------------ ------------
  Dashboard             Full   Operational            Limited     Assigned     Personal
                                                                      view 

  Members               Full        Manage    Register/search     Assigned  Own profile
                                                                      only 

  Membership            Full        Manage               View           No     View own
  plans                                                                    

  Renewals              Full        Manage   Permission-based           No Request only

  Payments              Full        Manage    Record/view per           No Own receipts
                                                       policy              

  Expenses              Full        Manage      No or limited           No           No

  Attendance            Full        Manage           Check-in     Assigned  Own history
                                                                      view 

  Trainers              Full        Manage               View  Own profile         View

  Workout plans         Full        Manage    View if allowed     Assigned     Own plan
                                                                     plans 

  Reports               Full      Selected            Limited  Own metrics     Personal

  Staff/roles           Full    Restricted                 No           No           No

  SaaS billing         Owner            No                 No           No           No

  AI tools      According to  According to            Limited      Limited        Later
                  permission    permission                                 
  -------------------------------------------------------------------------------------

All permissions must be checked server-side, not only hidden in the
interface.

------------------------------------------------------------------------

# 13. Development methodology and delivery gates

Use an engineering lifecycle. Do not advance a phase while its exit
criteria fail.

## Phase 0 --- Repository and brand discovery

Tasks: - Inspect folder structure. - Identify existing website, logo,
brand kit, fonts, images, content and licenses. - Inspect current Git
state, package files and deployment. - Record what is reusable. -
Identify secrets accidentally present and stop before publishing. -
Produce `docs/PROJECT_AUDIT.md`.

Exit gate: owner can review a repository/assets audit and implementation
plan.

## Phase 1 --- Requirements and UX discovery

Tasks: - Interview pilot gym owner and receptionist. - Observe actual
member registration, attendance, payment and renewal workflow. - Confirm
membership policies, fees, plan durations, grace periods, refunds and
expense categories. - Confirm roles and devices. - Map top 10 daily
tasks. - Produce user stories and acceptance criteria. - Create
responsive wireframes and click-through prototype.

Exit gate: pilot owner signs off P0 workflows.

## Phase 2 --- Architecture and threat model

Tasks: - Confirm hosting and Supabase project. - Create architecture
diagram. - Create ERD. - Define RLS policies. - Define subscription
entitlements. - Define AI/voice privacy boundary. - Define backup and
restore approach. - Record decisions in ADRs.

Exit gate: architecture and security review approved.

## Phase 3 --- Foundation

Tasks: - Vite + React + TypeScript. - Lint, format, type-check, test
scripts. - Design tokens and responsive shell. - Auth and tenant
membership. - Supabase migrations. - CI workflow. - Error boundaries and
telemetry.

Exit gate: users can sign in and only see authorized tenant shell.

## Phase 4 --- Core operations

Build in this order: 1. Member management. 2. Membership plans and
member memberships. 3. Attendance. 4. Payments and receipts. 5.
Expenses. 6. Dashboard and reports.

Each module includes UI, validation, backend, RLS, audit, tests and
docs.

Exit gate: P0 workflows pass integration and E2E tests.

## Phase 5 --- Tablet/mobile refinement and PWA

Tasks: - Test all viewport modes. - PWA manifest and icons. - Safe
app-shell caching. - Offline indicator. - Keyboard/touch support. -
Accessibility checks. - Performance budget.

Exit gate: no critical responsive defects; no unsafe offline writes.

## Phase 6 --- AI text assistant and tool execution

Tasks: - XS AI Gateway. - Provider adapters. - Quotas and routing. -
Tool schemas and authorization. - Audit and confirmation UI. -
Prompt-injection tests. - Data minimization.

Exit gate: AI can answer approved data queries and safely
prepare/execute permitted actions.

## Phase 7 --- Voice AI

Tasks: - Push-to-talk UI. - STT/TTS provider proof of concept. -
Streaming response. - Interrupt/cancel. - Malayalam/English/Manglish
tests. - Confirmation flow. - Permission and offline fallback. -
Cost/usage meter.

Exit gate: voice works reliably on supported target browsers/devices;
text fallback is always available.

## Phase 8 --- SaaS subscription

Tasks: - Trial activation. - 30-day server-side expiry. -
Entitlements. - Upgrade page. - Manual verified payment flow or gateway
integration. - Expiry reminders. - Data export and expired-state access.

Exit gate: trial cannot be reset by logout, device change or client
manipulation.

## Phase 9 --- QA, security and UAT

Tasks: - Full regression. - RLS cross-tenant tests. - Payment arithmetic
tests. - Date/time boundary tests. - Voice action tests. - Performance
and accessibility. - Backup/restore drill. - Pilot owner acceptance.

Exit gate: no open critical/high severity issues; owner signs off.

## Phase 10 --- Production deployment

Tasks: - Verify domain and DNS. - Configure GitHub Pages or chosen
static host. - Configure Supabase production environment. - Configure
redirect URLs and CORS as required. - Configure secrets. - Run
migrations. - Verify SSL. - Smoke tests. - Rollback plan. - Production
handover.

Exit gate: release checklist signed.

## Phase 11 --- Operate and improve

-   Weekly pilot feedback.
-   Error and latency review.
-   Quota and cost review.
-   Backup verification.
-   Feature adoption review.
-   Prioritize only validated needs.

------------------------------------------------------------------------

# 14. Coding standards and quality gates

## 14.1 TypeScript

-   Strict mode enabled.
-   Avoid `any`; explain unavoidable exceptions.
-   Shared domain types.
-   Runtime validation for external inputs.
-   Never assume LLM output is typed just because TypeScript says so.

## 14.2 React

-   Feature-based components.
-   Keep components focused.
-   Separate server state, local UI state and form state.
-   Avoid massive single-file components.
-   Avoid business calculations inside visual components.
-   Use accessible semantic HTML.
-   Handle loading, empty, error and success states.

## 14.3 Backend

-   Server-side validation.
-   Least-privilege database access.
-   Transactions for multi-row financial operations.
-   Explicit error codes.
-   Idempotency for retryable writes.
-   Audit important mutations.
-   Avoid exposing internal SQL/database errors to end users.

## 14.4 Git workflow

-   `main` is deployable.
-   Feature branches for work.
-   Pull request for non-trivial changes.
-   Small commits with meaningful messages.
-   No secrets or real member data in commits.
-   CI must pass before merge.
-   Tag releases and maintain changelog.

## 14.5 Definition of Done

A feature is done only if: - acceptance criteria met; - responsive UI
complete; - form/input validation complete; - backend logic complete; -
RLS and permission checks complete; - error and empty states complete; -
unit/integration/E2E tests appropriate to risk; - accessibility
reviewed; - documentation updated; - code reviewed; - staging
verified; - audit behaviour verified for important actions.

------------------------------------------------------------------------

# 15. Testing strategy

## 15.1 Unit tests

Test: - Membership date calculations. - Leap years and month-end
renewal. - Grace period. - Paise arithmetic. - Discounts and partial
payments. - Outstanding dues. - Reversal and refund accounting. -
Attendance duplicate rules. - Trial expiry boundary. - Entitlement
evaluation. - AI tool schema validation.

## 15.2 Integration tests

Test: - Auth and tenant membership. - RLS policies. - Member creation
and update. - Membership renewal transaction. - Payment creation and
reversal. - Expense creation. - Dashboard query reconciliation. - AI
tools with authorized and unauthorized users. - Subscription state
changes.

## 15.3 E2E tests (Playwright)

Critical scenarios: 1. Owner signs in. 2. Owner creates a membership
plan. 3. Receptionist creates a member. 4. Receptionist records a
payment. 5. Member is checked in. 6. Owner views daily collection
report. 7. Owner renews a membership. 8. Expiry alert appears. 9.
Unauthorized trainer cannot view financial reports. 10. Gym A cannot
access Gym B data. 11. Trial expires and paid features are blocked. 12.
Data export remains available after trial expiry. 13. Voice asks for a
report and reads the correct result. 14. Voice attempts a payment action
and asks for confirmation. 15. Duplicate voice submission does not
create duplicate payment.

## 15.4 Responsive matrix

At minimum test: - 360×800 phone. - 390×844 phone. - 430×932 large
phone. - 768×1024 tablet portrait. - 1024×768 tablet landscape. -
1180×820 tablet/laptop boundary. - 1366×768 laptop. - 1440×900 desktop.

Also test browser zoom at 200%, orientation changes and keyboard
navigation.

## 15.5 Security tests

-   Tenant isolation.
-   Role escalation.
-   Direct API calls bypassing hidden UI.
-   Forged gym ID.
-   Forged subscription state.
-   Service-role exposure scan.
-   Stored/reflected XSS.
-   Malicious file upload.
-   Webhook signature validation.
-   Replay/duplicate payment event.
-   Prompt injection in member notes and uploaded content.
-   AI tool permission bypass.
-   Sensitive data leakage in model context/logs.

## 15.6 Performance tests

-   Large member list pagination.
-   Dashboard under realistic data volume.
-   Search under load.
-   Slow network and high latency.
-   Provider timeout/fallback.
-   Multiple concurrent front-desk users.
-   Bundle size and Web Vitals.

------------------------------------------------------------------------

# 16. GitHub repositories, libraries and tools to evaluate

These are reference projects and dependencies, not instructions to
blindly clone code. Check current maintenance, licence, security
advisories, compatibility and release activity before adopting anything.
Do not copy an entire gym management repository into the product without
reviewing its architecture and licence.

## 16.1 Core application

  --------------------------------------------------------------------------------------------------------------------
  Tool / repository Use                     Install / access                                         When
  ----------------- ----------------------- -------------------------------------------------------- -----------------
  React             UI framework            `npm install react react-dom`                            Foundation

  Vite              Build/dev server        `npm create vite@latest xs-gym -- --template react-ts`   Foundation

  TypeScript        Type safety             Included in React TS template                            Foundation

  Supabase JS       Auth/database/storage   `npm install @supabase/supabase-js`                      Foundation
                    client                                                                           

  Supabase CLI      Local backend,          `npm install -D supabase` or official CLI install        Foundation
                    migrations, functions                                                            

  React Router      Client routes           `npm install react-router-dom`                           Foundation

  TanStack Query    Server state/cache      `npm install @tanstack/react-query`                      As data modules
                                                                                                     grow

  React Hook Form + Forms and validation    `npm install react-hook-form zod @hookform/resolvers`    Forms
  Zod                                                                                                

  date-fns          Date helpers            `npm install date-fns`                                   Membership dates

  Lucide React      Icons                   `npm install lucide-react`                               UI

  Recharts          Charts                  `npm install recharts`                                   Reports only

  vite-plugin-pwa   PWA/service worker      `npm install -D vite-plugin-pwa`                         PWA phase
  --------------------------------------------------------------------------------------------------------------------

Official references: - React: https://react.dev/ - Vite:
https://vite.dev/ - Supabase: https://supabase.com/docs - Supabase React
quickstart: https://supabase.com/docs/guides/auth/quickstarts/react -
Vite PWA: https://github.com/vite-pwa/vite-plugin-pwa

## 16.2 UI components and design

  --------------------------------------------------------------------------------
  Tool              Use               Install                    Guidance
  ----------------- ----------------- -------------------------- -----------------
  Tailwind CSS      Utility styling   Follow current Vite        Use only if it
                                      integration docs           fits existing
                                                                 brand system

  shadcn/ui         Accessible        `npx shadcn@latest init`   Add components
                    component source                             selectively

  Radix UI          Accessible        Installed by selected      Avoid duplicate
                    primitives        shadcn components          component systems

  Sonner            Toast             `npm install sonner`       Non-blocking
                    notifications                                feedback
  --------------------------------------------------------------------------------

References: - Tailwind: https://tailwindcss.com/docs - shadcn/ui:
https://ui.shadcn.com/docs - Radix:
https://www.radix-ui.com/primitives - Sonner:
https://sonner.emilkowal.ski/

## 16.3 AI and model routing

  ------------------------------------------------------------------------------------
  Project           Why evaluate            Install / use           Notes
  ----------------- ----------------------- ----------------------- ------------------
  Vercel AI SDK     TypeScript AI           `npm install ai` plus   Strong
                    abstraction, streaming  only the provider       frontend/backend
                    and tools               packages selected       TypeScript fit;
                                                                    server-side calls
                                                                    only

  LiteLLM           Unified API for many    Python:                 Requires a
                    providers,              `pip install litellm`   server/runtime if
                    retry/fallback/router   or `uv add litellm`     used as a proxy

  OpenRouter        One API for multiple    Account/API key; use    Free models and
                    model providers         server-side adapter     availability vary;
                                                                    not an unlimited
                                                                    free service

  Gemini API        Primary candidate for   Official Google AI      Verify current
                    free-tier testing       Studio/API docs         free tier, tool
                                                                    calling, privacy
                                                                    and rate limits

  Groq API          Low-latency inference   Official Groq docs      Model availability
                    candidate                                       and free quotas
                                                                    change

  Vercel AI Gateway Managed                 Official Vercel docs    Evaluate pricing
                    routing/fallback option                         and terms; not
                                                                    assumed free
  ------------------------------------------------------------------------------------

Repositories and docs: - Vercel AI SDK: https://github.com/vercel/ai -
LiteLLM: https://github.com/BerriAI/litellm - OpenRouter docs:
https://openrouter.ai/docs - Gemini API docs:
https://ai.google.dev/gemini-api/docs - Groq docs:
https://console.groq.com/docs - Vercel AI Gateway:
https://vercel.com/docs/ai-gateway

**Do not use a random "free LLM API key" repository as a source of
credentials.** A repository can provide a client, router or list of
providers; it cannot legitimately grant unlimited third-party API quota.
Never use shared, leaked, scraped or hard-coded keys.

## 16.4 Voice and realtime audio

Evaluate these options with a small proof of concept before committing:

  ------------------------------------------------------------------------------------------------
  Project/API       Use                  Install / access                        Trade-off
  ----------------- -------------------- --------------------------------------- -----------------
  Browser Web       Prototype/fallback   Browser API; no package                 Browser and
  Speech API        STT/TTS                                                      language support
                                                                                 vary

  LiveKit Agents    Realtime voice agent https://github.com/livekit/agents       Requires
                    framework                                                    compatible
                                                                                 server/agent
                                                                                 deployment and
                                                                                 provider
                                                                                 credentials

  Pipecat           Open-source          https://github.com/pipecat-ai/pipecat   Python runtime
                    voice/realtime AI                                            and deployment
                    framework                                                    required

  Google Cloud      Managed speech       Official Google Cloud docs              Verify Malayalam
  Speech / TTS      services                                                     locale, quota and
                                                                                 pricing

  OpenAI Realtime / Realtime voice       Official API docs                       Paid usage may
  speech APIs       option                                                       apply; keep
                                                                                 optional

  ElevenLabs        TTS voice quality    Official docs                           Paid usage/voice
                    option                                                       licensing may
                                                                                 apply
  ------------------------------------------------------------------------------------------------

Do not install LiveKit or Pipecat just because they are popular. For the
first pilot, first test browser push-to-talk and one managed speech
pipeline. Adopt a separate realtime agent server only if it materially
improves latency, Malayalam recognition and conversation quality.

## 16.5 Testing and quality

  ---------------------------------------------------------------------------------------------------------------------------------------------------
  Tool                    Use                         Install
  ----------------------- --------------------------- -----------------------------------------------------------------------------------------------
  Vitest                  Unit/component test runner  `npm install -D vitest`

  React Testing Library   Component tests             `npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom`

  Playwright              Browser E2E tests           `npm install -D @playwright/test` then `npx playwright install`

  axe-core Playwright     Accessibility tests         `npm install -D @axe-core/playwright`

  ESLint                  Lint                        Use current Vite/React TypeScript setup

  Prettier                Formatting                  `npm install -D prettier`

  Lighthouse CI           Performance/accessibility   `npm install -D @lhci/cli` or use its documented CI action
                          audit                       
  ---------------------------------------------------------------------------------------------------------------------------------------------------

References: - Vitest: https://vitest.dev/ - Testing Library:
https://testing-library.com/docs/react-testing-library/intro/ -
Playwright: https://playwright.dev/ - axe-core:
https://github.com/dequelabs/axe-core - Lighthouse CI:
https://github.com/GoogleChrome/lighthouse-ci

## 16.6 Gym management references

Use these only to study workflows and feature coverage. Do not copy
without licence and security review.

-   GitHub Gym Management topic:
    https://github.com/topics/gym-management
-   GitHub Gym Management System topic:
    https://github.com/topics/gym-management-system
-   GYM-One: https://github.com/mayerbalintdev/GYM-One
-   Laragym: https://github.com/johndavedecano/laragym

Review each repository's licence, dependencies, data model, tenant
isolation, code quality and current maintenance. These are not
automatically suitable for our React + Supabase stack.

## 16.7 Optional skills for Codex

Codex should use its available coding, browser, terminal and testing
capabilities. If the environment supports agent skills, create or
install project-local skills rather than assuming a global skill is
available.

Suggested project-local skills to author: - `xs-brand-system`: inspect
and apply supplied Xelorsoft brand assets. - `xs-supabase-security`:
migrations, RLS, tenant isolation and security tests. -
`xs-responsive-qa`: phone/tablet portrait/tablet landscape/desktop
validation. - `xs-financial-correctness`: money, membership date and
reconciliation tests. - `xs-ai-tools`: tool schemas, authorization,
confirmation and audit. - `xs-voice-qa`: STT/TTS, Malayalam,
interruption and permission testing. - `xs-release-checklist`: CI,
backup, deploy, smoke test and rollback.

Do not install unknown agent skills blindly. Read their source, licence
and instructions first. A skill is guidance, not a substitute for tests.

------------------------------------------------------------------------

# 17. Codex execution instructions

When this file is provided to Codex together with the Xelorsoft assets
folder, use the following sequence.

## Step 1 --- Inspect, do not modify

-   List all files and folders.
-   Identify existing frontend/backend and framework.
-   Read README, package manifests, deployment config and Git history.
-   Inspect logo/brand kit, fonts and design references.
-   Identify duplicate assets and licences.
-   Check for secrets without printing their values.
-   Report findings.

Deliver: `docs/PROJECT_AUDIT.md`.

## Step 2 --- Create an implementation plan

Create: - `docs/PRODUCT_REQUIREMENTS.md` - `docs/ARCHITECTURE.md` -
`docs/DATABASE.md` - `docs/SECURITY.md` - `docs/AI_AND_VOICE.md` -
`docs/TEST_PLAN.md` - `docs/DEPLOYMENT.md` - ADRs for major decisions.

Include: - what is already present; - what will be reused; - what must
be installed; - exact commands; - environment variables required (names
only); - external accounts the owner must create; - free-tier
limitations; - costs that may arise; - milestones and acceptance
criteria.

Do not ask the owner for secrets in plain text.

## Step 3 --- Verify dependencies

Before installation: - inspect current package versions and Node
version; - check compatibility and licences; - use maintained stable
versions; - avoid unnecessary packages; - pin versions through
lockfile; - explain why each dependency is needed.

Install only the packages required for the approved phase. Do not
install every optional tool in this document at once.

## Step 4 --- Build a working vertical slice

First deliver: - responsive shell; - authentication; - tenant
resolution; - RLS; - member create/search; - membership plan; -
attendance check-in; - payment record with audit; - dashboard totals.

Use test tenant data until UAT approval.

## Step 5 --- Test before adding more modules

Run: - lint; - typecheck; - unit tests; - integration tests; -
Playwright E2E; - RLS security tests; - responsive viewport tests.

Fix failures before moving on.

## Step 6 --- Add AI and voice only after reliable core data

AI must use the approved tool catalogue. Do not let it execute arbitrary
SQL or bypass permissions. Start with read-only reports, then safe draft
creation, then confirmed writes.

## Step 7 --- Prepare production

-   Configure production Supabase.
-   Configure GitHub Actions.
-   Configure DNS and custom domain.
-   Configure secrets securely.
-   Export and test restore.
-   Run security and UAT gates.
-   Deploy only after written owner approval.

## Step 8 --- Handover

Provide: - source code and Git repository; - environment variable
template; - migration history; - deployment instructions; - admin/owner
guide; - backup and restore guide; - test report; - known limitations; -
recurring cost/quota estimate; - rollback steps.

------------------------------------------------------------------------

# 18. Environment variables

Create `.env.example` with names and placeholders only. Exact variables
depend on the selected implementation.

Possible frontend-safe variables:

``` env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_APP_URL=
```

Server-side Supabase Edge Function secrets (never prefix with `VITE_`):

``` env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GROQ_API_KEY=
OPENROUTER_API_KEY=
AI_DEFAULT_PROVIDER=
AI_FALLBACK_PROVIDERS=
VOICE_STT_PROVIDER=
VOICE_TTS_PROVIDER=
VOICE_PROVIDER_API_KEY=
PAYMENT_PROVIDER_SECRET=
PAYMENT_WEBHOOK_SECRET=
```

Do not define every provider secret if that provider is not selected.
Use the runtime's official secret management. Supabase Edge Functions
have their own environment and secret configuration; confirm the current
CLI workflow.

------------------------------------------------------------------------

# 19. Analytics and operational KPIs

Measure product quality, not vanity metrics.

## Gym usage

-   Daily active staff.
-   Members added.
-   Attendance records per day.
-   Payments recorded.
-   Membership renewals.
-   Report usage.
-   Time to complete member registration.
-   Time to complete check-in.

## Product reliability

-   API error rate.
-   p50/p95 latency.
-   Uptime/availability.
-   Failed login rate.
-   Failed payment writes.
-   Duplicate transaction attempts.
-   Data export success.
-   Backup/restore success.

## AI and voice

-   Voice session success rate.
-   Speech recognition correction rate.
-   Median time to first response.
-   Tool call success/failure.
-   Confirmation rejection rate.
-   Provider fallback rate.
-   Token/audio usage per tenant.
-   Cost per active tenant.
-   Hallucinated action rate (target zero confirmed writes without
    backend result).

## SaaS

-   Trial activation.
-   Trial-to-paid conversion.
-   Monthly active gyms.
-   Churn.
-   Support requests per tenant.
-   Infrastructure cost per tenant.

------------------------------------------------------------------------

# 20. Backup, disaster recovery and continuity

Free-tier hosting must not mean no backup.

-   Schedule regular logical database exports using Supabase CLI or
    documented PostgreSQL backup process.
-   Store encrypted backups outside the live project.
-   Restrict backup access.
-   Do not put customer data dumps in public GitHub repositories.
-   Define retention and deletion policy.
-   Test restore to a separate staging project.
-   Record recovery point objective (RPO) and recovery time objective
    (RTO).
-   Before production, agree on how much data loss and downtime the gym
    can tolerate.
-   Keep migration files in Git.
-   Keep storage object backup strategy separate from database backup.
-   A database dump does not automatically back up every Storage object.

If the pilot business depends on the system daily, consider a paid
Supabase tier or another backup arrangement once the cost is justified.
Do not promise automatic backups on a free plan.

------------------------------------------------------------------------

# 21. Rollout and customer onboarding

## 21.1 Pilot onboarding

-   Create gym tenant.
-   Configure gym name, timezone, contact and operating hours.
-   Create owner account.
-   Invite manager/receptionist/trainer accounts.
-   Configure membership plans and fees.
-   Configure attendance rules.
-   Configure expense categories.
-   Import member records after validation and owner approval.
-   Train staff using real scenarios.
-   Keep a manual fallback process during the first week.

## 21.2 Training

Provide a concise guide for: - Add member. - Record payment. - Check in
member. - Renew membership. - Add expense. - View due/expiry list. - Use
voice assistant. - Correct an error safely. - Export data.

## 21.3 UAT sign-off

Pilot owner must verify: - member list matches source records; - plan
prices/durations match gym policy; - payment totals reconcile; -
attendance flow is usable; - expiry rules behave correctly; - staff
roles are correct; - mobile/tablet/desktop layouts work; - AI does not
expose unauthorized data; - voice actions require confirmation where
appropriate.

------------------------------------------------------------------------

# 22. Risks and mitigations

  -----------------------------------------------------------------------
  Risk                                Mitigation
  ----------------------------------- -----------------------------------
  Free service quota exhausted        Usage caps, provider fallback,
                                      graceful degraded mode, cost alert

  Provider changes free tier          Configurable adapters, no provider
                                      lock-in

  AI gives incorrect financial answer Deterministic database functions
                                      and source-backed results

  Voice mishears member or amount     Read-back, confidence checks,
                                      confirmation

  Cross-gym data leakage              RLS, server checks, automated
                                      tenant-isolation tests

  GitHub Pages SPA routing issue      Test deep links; use compatible
                                      routing/fallback

  Supabase free project pauses        Understand pause policy; upgrade or
                                      operational plan before
                                      business-critical use

  No automatic free-tier backup       Scheduled export, encrypted
                                      off-site backup, restore test

  Tablet layout breaks on rotation    Responsive tests at portrait and
                                      landscape widths

  Slow dashboard                      Query indexes, pagination, caching,
                                      bundle splitting, monitoring

  Trial reset abuse                   Server-side tenant subscription
                                      history

  Duplicate payment after retry       Idempotency keys and unique
                                      references

  Unapproved bulk messaging           Preview, consent checks and
                                      explicit confirmation

  Sensitive data sent to LLM          Data minimization, redaction and
                                      provider policy review

  Scope becomes too large             P0/P1/P2 gates; pilot validation
                                      before expansion
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 23. Explicit non-goals for the first release

Do not delay the pilot by trying to build all of these at once: -
Biometric hardware integrations. - Full accounting/ERP. - Payroll. -
Automated bank reconciliation. - Native iOS and Android applications. -
Wearable integrations. - Complex multi-branch franchise management. - AI
medical diagnosis or treatment. - Fully autonomous financial actions. -
Arbitrary custom workflow builder. - Unlimited AI/voice usage on free
quotas.

Design the architecture so these can be added later, but do not build
them before validated demand.

------------------------------------------------------------------------

# 24. Release acceptance checklist

## Product

-   [ ] Pilot gym workflows documented.
-   [ ] Owner approves P0 scope.
-   [ ] Member and membership data validated.
-   [ ] Dashboard metrics defined.

## UX

-   [ ] Phone portrait tested.
-   [ ] Tablet portrait tested.
-   [ ] Tablet landscape tested.
-   [ ] Laptop tested.
-   [ ] Desktop tested.
-   [ ] Keyboard and touch supported.
-   [ ] No critical accessibility defects.

## Backend and security

-   [ ] Migrations committed.
-   [ ] RLS on all tenant tables.
-   [ ] Cross-tenant tests pass.
-   [ ] Roles enforced server-side.
-   [ ] Secrets not exposed.
-   [ ] Audit logs work.
-   [ ] Upload permissions reviewed.

## Financial correctness

-   [ ] Paise-safe calculations.
-   [ ] Partial payments tested.
-   [ ] Refund/reversal tested.
-   [ ] Duplicate payment prevention tested.
-   [ ] Reports reconcile to transaction rows.
-   [ ] Date boundary tests pass.

## AI and voice

-   [ ] Provider routing tested.
-   [ ] Quota limits work.
-   [ ] Provider fallback tested.
-   [ ] Tool schema validation works.
-   [ ] Unauthorized tools rejected.
-   [ ] Write actions require confirmation.
-   [ ] Voice interruption/cancel works.
-   [ ] Malayalam/English test set completed.
-   [ ] No raw audio retained by default.

## SaaS subscription

-   [ ] 30-day trial starts server-side.
-   [ ] Trial cannot be reset by logout.
-   [ ] Expired entitlements blocked server-side.
-   [ ] Billing and data export remain accessible.
-   [ ] Paid activation requires verified payment/admin approval.

## Operations

-   [ ] CI passes.
-   [ ] E2E passes.
-   [ ] Backup export completed.
-   [ ] Restore test completed.
-   [ ] Deployment smoke test passed.
-   [ ] Rollback instructions ready.
-   [ ] Owner UAT sign-off received.

------------------------------------------------------------------------

# 25. Official documentation and reference links

Codex must verify current versions and instructions at implementation
time.

### Core

-   React: https://react.dev/
-   Vite: https://vite.dev/
-   TypeScript: https://www.typescriptlang.org/docs/
-   Supabase Docs: https://supabase.com/docs
-   Supabase React Auth quickstart:
    https://supabase.com/docs/guides/auth/quickstarts/react
-   Supabase RLS:
    https://supabase.com/docs/guides/database/postgres/row-level-security
-   Supabase Edge Functions: https://supabase.com/docs/guides/functions
-   Supabase backups: https://supabase.com/docs/guides/platform/backups
-   Supabase billing and quotas:
    https://supabase.com/docs/guides/platform/billing-on-supabase
-   Supabase custom domains:
    https://supabase.com/docs/guides/platform/custom-domains

### PWA and deployment

-   Vite PWA plugin: https://github.com/vite-pwa/vite-plugin-pwa
-   Vite PWA docs: https://vite-pwa-org.netlify.app/
-   GitHub Pages: https://docs.github.com/en/pages
-   GitHub custom domains:
    https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site
-   GitHub Actions: https://docs.github.com/en/actions

### AI

-   Vercel AI SDK: https://github.com/vercel/ai
-   AI SDK docs: https://ai-sdk.dev/docs/introduction
-   LiteLLM: https://github.com/BerriAI/litellm
-   LiteLLM docs: https://docs.litellm.ai/
-   Gemini API: https://ai.google.dev/gemini-api/docs
-   Groq API: https://console.groq.com/docs
-   OpenRouter: https://openrouter.ai/docs
-   Vercel AI Gateway: https://vercel.com/docs/ai-gateway

### Voice

-   MDN Web Speech API:
    https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
-   LiveKit Agents: https://github.com/livekit/agents
-   LiveKit docs: https://docs.livekit.io/
-   Pipecat: https://github.com/pipecat-ai/pipecat
-   Google Cloud Speech-to-Text:
    https://cloud.google.com/speech-to-text/docs
-   Google Cloud Text-to-Speech:
    https://cloud.google.com/text-to-speech/docs

### Quality and security

-   Vitest: https://vitest.dev/
-   Testing Library: https://testing-library.com/docs/
-   Playwright: https://playwright.dev/docs/intro
-   axe-core: https://github.com/dequelabs/axe-core
-   Lighthouse CI: https://github.com/GoogleChrome/lighthouse-ci
-   OWASP ASVS:
    https://owasp.org/www-project-application-security-verification-standard/
-   OWASP Top 10: https://owasp.org/www-project-top-ten/

### Gym workflow references

-   https://github.com/topics/gym-management
-   https://github.com/topics/gym-management-system
-   https://github.com/mayerbalintdev/GYM-One
-   https://github.com/johndavedecano/laragym

------------------------------------------------------------------------

# 26. Final direction to the engineering team

Build XS Gym as a real SaaS product, not a disposable demo. The first
gym is the pilot tenant. The application must be extremely easy on
mobile, adapt naturally to portrait and landscape tablets, and provide a
productive desktop experience.

Prioritize reliable member records, membership rules, attendance and
money handling. Add voice AI as an execution interface over secure,
deterministic business tools. Use model routing to reduce provider
dependence, but never confuse free API access with unlimited or
production-guaranteed service.

Keep the architecture modular, the UI simple, the data portable and the
operating cost visible. Build only what the pilot can validate, but
build the foundation correctly so Xelorsoft can onboard the next gym
without rewriting the product.

**The governing rule: no feature is finished because it looks complete.
It is finished only when it works, is secure, is tested, is responsive,
is documented and is accepted by the real user.**
