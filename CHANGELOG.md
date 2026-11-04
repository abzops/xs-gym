# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow semantic versioning from the first app release.

## [Unreleased]

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
