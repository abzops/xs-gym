# XS Gym — Test Plan

Expands blueprint §15. A feature is not done until its tests pass in CI.

## 1. Levels and tools

| Level | Tool | Runs where |
|---|---|---|
| Unit (pure TS: money format/parse, display dates, validators) | Vitest | Workspace + CI |
| Component (forms, states, accessibility of widgets) | Vitest + Testing Library | Workspace + CI |
| Database (functions, constraints, RLS, command functions) | Vitest + `pg`, switching role and JWT claims per test | Workspace (PG16 + auth stand-in) + **CI (real Supabase stack)** |
| End-to-end (critical journeys) | Playwright | CI against real Supabase stack |
| Accessibility | `@axe-core/playwright` + manual keyboard/screen-reader pass | CI + UAT |
| Performance | Lighthouse CI, bundle size check | CI |
| Responsive | Playwright viewport matrix + real devices | CI + UAT |

## 2. Database test harness

Each test runs inside a transaction that is rolled back. Identity is simulated the
way Supabase does it:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<user-uuid>","role":"authenticated"}', true);
```

The workspace stand-in creates `auth.users`, `auth.uid()`, `auth.jwt()` and the
`anon`, `authenticated`, `service_role` roles. Only behaviour that also passes on
the real stack in CI counts (ADR-0006).

## 3. Required vectors

- **Dates:** the 13 end-date vectors in `DATABASE.md` §5 (verified on PG16, 05 Nov
  2026) plus status on each boundary day (start, end, end+1, last grace day,
  first expired day), freezes spanning month ends, and gym-local midnight
  (23:59 and 00:00 IST).
- **Money:** partial payments, overpayment → credit, allocation order, discount
  limits, reversal of an allocated payment, collections/reversals on different
  days, report totals equal raw-row sums, no float paths (property test over
  random paise amounts round-tripping display ↔ storage).
- **Idempotency:** same key twice → one row, same response; same key with
  different payload → `XS409`.

## 4. Security suite

Seed two gyms (A, B) with owner, manager, receptionist and trainer in each. For
every table and command function, assert: A's staff cannot read or write B's
rows; each role gets exactly its permission set (`SECURITY.md` §3); anon gets
nothing; forged `gym_id`/`member_id` fails; ledger and audit rows cannot be
updated or deleted by any API role; expired tenant is read-only (D-06); the built
`dist/` contains no service-role or provider key patterns.

## 5. End-to-end journeys (blueprint §15.3)

1 owner signs in · 2 creates plan · 3 receptionist adds member · 4 records
payment · 5 checks member in · 6 owner views daily collections · 7 renews
membership · 8 expiry alert shows · 9 trainer blocked from financial reports ·
10 gym A cannot see gym B · 11 expired trial blocks writes · 12 export still works
after expiry · 13–15 voice report, voice payment confirmation, duplicate voice
submit creates one payment (Phase 7).

## 6. Responsive matrix

360×800, 390×844, 430×932, 768×1024, 1024×768, 1180×820, 1366×768, 1440×900;
plus 200 % zoom, rotation mid-form (state kept), keyboard-only navigation. Checks:
no horizontal page scroll, touch targets ≥ 44 px, primary action reachable,
tables readable or deliberately scrollable.

## 7. CI gates (every pull request)

Format → lint → typecheck → unit/component → DB tests on Supabase stack → E2E →
axe → bundle size → secret scan. Any failure blocks merge and deploy.

## 8. UAT

Pilot owner and one receptionist run the top-10 daily tasks on their own devices
against staging with synthetic data, then a sample of real imported data. Sign-off
checklist: blueprint §21.3.
