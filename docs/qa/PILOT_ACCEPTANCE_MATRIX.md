# XS Gym — Pilot Acceptance Matrix

**Prepared:** 2026-11-11 | **Production source:** `9b8da8b` | **Safety release posture:** HOLD  
**Test fixtures:** synthetic gyms/members/payments only. Do not copy pilot customer data.

| Function / safeguard | Current evidence | Remaining acceptance gate |
|---|---|---|
| Build, typecheck, lint and unit tests | [Production CI run 43024755329](https://github.com/abzops/xs-gym/actions/runs/43024755329) PASSED | Re-run for exact candidate feature commit in isolated CI |
| Phone/tablet/laptop E2E | [Production E2E run 43024755469](https://github.com/abzops/xs-gym/actions/runs/43024755469) PASSED, 43/43 on each simulated device | Physical iPhone/Android and low-connectivity walkthrough with pilot staff |
| Member create/edit/joining date | Existing E2E on isolated database covers date edit and reload | UAT: saved date correct, subscription dates unchanged, no duplicate person |
| Swipe Archive/Restore/Delete | Existing isolated E2E covers these actions | Explicit delete policy; confirm no accidental loss of protected history |
| Payment record/reverse/correct | Existing synthetic DB+E2E tests cover audit and idempotent retry | Concurrent requests, payment reference failures, actual receipt reconciliation |
| Paid charge void | Current behavior confirmed in source; new synthetic regression on audit branch | Owner explicitly selects whether membership access stays active |
| Cross-tenant RLS/RPC permissions | Existing DB test uses Gym A/B and multiple roles | Extended adversarial tests and full 24-RPC permission review |
| Trial expiry / read-only mode | Synthetic DB test exists | Confirm UI view/export after expiry and owner escalation |
| Signup, confirmation and password reset | Frontend flows exist | Live Auth redirect/SMTP/leaked-password settings require manual check (do not change in pilot) |
| Pilot CSV member import | Client preview and validation exist | Stable import batch ID, dry-run/retry and source-vs-database reconciliation after permission |
| Recoverable backups | **No production restore evidence**; zero private snapshot rows observed | Owner-approved encrypted backup plan; synthetic drill first, then approved protected restore |
| XS AI in English/Malayalam | Edge Function active, simulated tests in CI | Real phone microphone + language accuracy + AI budget/permissions checks |
| Runtime support and monitoring | GitHub Pages job success, Supabase project healthy | Direct browser availability, error monitoring, alert route, rollback on fault |
| Publication | `main` push auto-publishes, branch protection absent | Owner-approved time window, reviewed PR, SHA, complete CI and actual recovery proof |

## Current known synthetic baseline results

- App CI / database CI: PASS, 2026-11-11 [run 43024755329](https://github.com/abzops/xs-gym/actions/runs/43024755329).
- Isolated E2E: PASS, 43/43 on phone, 43/43 on tablet, 43/43 on laptop, [run 43024755469](https://github.com/abzops/xs-gym/actions/runs/43024755469).
- Device suite uses browser-simulated touch; this is **not** proof of installed iPhone behavior.
- New `feature/pilot-safety-audit` work: synthetic finance regression and local restore drill **written; CI execution evidence pending** at draft time.

## UAT sign-off prerequisites (pilot-specific)

1. Pilot owner confirms member onboarding is complete and gives permission for a *read-only, per-row* reconciliation.
2. Reconciliation checks names, phone format, join dates, membership state and balances without exporting personal data to CI or chat.
3. Gym owner/receptionist tests one workday of add/renew/pay/edit/report on their real devices under an approved, monitored UAT plan.
4. Finance totals independently match the gym's records for a selected sample and date range.
5. Backup/restore plan is demonstrated, owner signs off, and release gates in the Development & Pilot Protection Guide are satisfied.

**Do not declare pilot acceptance or production readiness from test-count percentages alone.**
