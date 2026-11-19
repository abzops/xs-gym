# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow semantic versioning from the first app release.

## [Unreleased]

### Added — Pay for XS Gym with Razorpay (19 Nov 2026)

- Settings → Subscription: the gym owner picks Monthly or Yearly and pays on Razorpay's
  page (UPI, card, net banking), then returns to XS Gym. The paid period starts when the
  trial or current period ends, so no days are lost. Works when the subscription has
  ended (the "Subscription ended" banner links to it).
- Edge Function `xs-billing` makes the Razorpay payment link and confirms payment with
  Razorpay before anything changes; `xs-billing-webhook` applies payments even if the
  owner closes the browser (Razorpay `payment_link.paid`, signature checked).
- Migration `saas_billing`: `saas_prices` (change prices here), `saas_payments`,
  `prepare_saas_payment` (owner only), `apply_saas_payment` (server only, idempotent, audited).
- Secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
- DB tests: tests/db/test_billing.sql (19 checks).

### Added — Staff logins made by the owner (19 Nov 2026)

- Settings → Staff → Add staff: the owner enters name, WhatsApp number and access
  (Reception, Trainer or Manager). XS Gym makes a username (e.g. `ravi.chaos`) and a
  password, shown once, with a ready WhatsApp message in English or Malayalam
  (one tap to send; it includes a sign-in link with the username filled in).
- Staff sign in with their username — no email or sign-up needed. The owner can edit
  name, phone, access, switch access off, reset the password (old one stops working),
  or remove them (logins made in XS Gym are deleted; email accounts are only unlinked).
- Edge Function `staff-login`: every check runs in the database as the owner
  (`prepare_staff_login`, `attach_staff_login`, `prepare_staff_password_reset`,
  `update_staff`, `remove_staff`); the service key only creates the account or sets its password.
  Accounts are rolled back if linking fails. Passwords are never stored or logged by XS Gym.
- Adding an existing account by email still works ("Add by email").
- Tests: 30 database checks, 14 function contract checks, 3 browser steps on phone, tablet, laptop.

### Added — P0 core operations (05 Nov 2026)

- Supabase backend: tenants, staff roles and permissions, 30-day trial, append-only audit log,
  members, plans, memberships, charges/payments/allocations/reversals ledger, attendance, expenses.
- Command functions for every write (authorise, validate, idempotent, audited) and report functions.
- App: sign-in, sign-up, password reset, gym setup, dashboard, front-desk check-in, members,
  sell/renew, payments, plans, expenses, reports with CSV, settings and staff.
- Tests: 67 database checks, 29 unit tests, responsive checks of 9 screens at 4 sizes.
- CI publishes to GitHub Pages after all checks and a secret scan pass.

### Added — Phase 0 (05 Nov 2026)

- Engineering blueprint v1.0 as the source specification.
- Supplied Xelorsoft brand assets (unchanged, with checksums) and three SVG masters
  recovered from the vector PDF.
- Phase 0 project audit, implementation plan, owner decisions register.
- Design drafts: architecture, database (13 date vectors verified on PostgreSQL 16),
  security, AI and voice, test plan, deployment, product requirements.
- ADR-0001 to ADR-0008.
- Status page and GitHub Pages workflow.
- `PROGRESS.md` handover log.
