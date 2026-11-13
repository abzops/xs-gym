# XS Gym — Security, Tenancy, and Privileged RPC Review

**Date:** 2026-11-11 | **Method:** read-only schema/advisor inventory + source inspection  
**Production changes:** NONE | **Customer data:** not exported

## Current observed controls

- 17/17 `public` tables have Row Level Security enabled (verified using Supabase metadata and catalog).
- All **24 `public` SECURITY DEFINER RPC overloads** have `search_path=''`; catalog reports `anon EXECUTE = false` and `authenticated EXECUTE = true`. That is a useful hardening baseline, **not proof** of authorization correctness.
- Tenant-scoped tables are designed with `gym_id` plus composite tenant foreign keys; check all affected functions individually.
- Payment and allocation tables have immutable-history constraints and database write paths via privileged command functions.
- `public.member_overview` is defined `security_invoker=true` in source.
- Edge Function `xs-ai` is active with JWT verification enabled. Whether every tool path acts as the signed-in user rather than a service role remains a code-review and synthetic-test requirement.
- Both `members` and `payments` tables expose SELECT (not INSERT/UPDATE/DELETE) to `authenticated`. Some tables also expose REFERENCES/TRIGGER; investigate whether these grants are necessary in the PostgREST threat model.

## Supabase advisor findings

| Finding | Severity at audit | Current interpretation | Reference |
|---|---|---|---|
| `authenticated_security_definer_function_executable` × 24 | WARN / needs triage | Intended public command endpoints run with elevated privilege. Verify authentication, tenant ownership, role permission and object ID checks for *each*, especially payment correction and hard delete | [Linter 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| `auth_leaked_password_protection` × 1 | WARN / manual config check | Check password leak protection and available plan entitlement in Auth dashboard. No Auth setting changed | [Password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
| Unindexed foreign keys × 13 | INFO | Query-planning and performance potential; no index changes before benchmarks | [Linter 0001](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) |
| Unused indexes × 2 | INFO | Not automatically safe to drop on a small/low-activity database | [Linter 0005](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) |

## RPC review queue

**24 overloads were inventoried**: `cancel_membership`, `check_in`, `complete_onboarding`, `correct_payment`, `create_gym`, `create_member`, `daily_report`, `dashboard_summary`, `gym_analytics`, `permanently_delete_member`, `record_expense`, `record_payment`, `reverse_expense`, `reverse_payment`, `save_enquiry`, `save_plan`, `save_staff`, `sell_membership`, `set_member_status`, `update_gym_settings`, `update_member` (two overloads), `void_charge`, `void_check_in`.

The critical operations to scrutinize first:

1. **`correct_payment`** — tenant and member binding; `payments.reverse` + `payments.record` authorizations; idempotency key collision and concurrent transaction safety; prior payment/receipt traceability.
2. **`permanently_delete_member`** — gym owner role requirement, member-number match, no financial/membership/attendance history; investigate linked enquiry deletion and separate import/purge mechanisms. Do not weaken guardrails for the pilot.
3. **`save_staff` / `create_gym`** — ownership changes, role escalation, invitation identity and trial bypass.
4. **`sell_membership` / `void_charge`** — cross-gym plan/member IDs and credit/benefit effects.
5. **Read RPCs `gym_analytics`, `daily_report`, `dashboard_summary`** — financial aggregation permissions; avoid supplying unauthorized rows across gyms.

## Evidence and planned adversarial matrix (synthetic Test Gym A/B)

| Actor | Test | Expected |
|---|---|---|
| Anonymous | EXECUTE public financial/member RPCs | Blocked |
| Gym A owner | Read/update Gym B members, payments, reports, plans | Blocked without metadata leakage |
| Gym A manager | Permanently delete never-transacted Gym A member | Blocked (owner only) |
| Gym A reception | Correct/reverse payment, change role to owner | Blocked |
| Gym A trainer | Read others' payments, create member | Blocked |
| Gym A owner | Delete billed Gym A member | Blocked and ledger preserved |
| Expired trial user | Attempt writes in their own gym | Blocked; read/export policy retained |
| Authenticated unrelated user | Execute `create_gym`, then attack another gym | Only own newly created gym accessible |
| Same gym, duplicate payment submissions | Reuse same UUID/different payload | Exactly one immutable receipt; conflict on mismatch |

Many baseline variants already exist in `tests/db/test_core.sql`; the remaining concurrent and fault-injection cases must be separately proven. Use **local PostgreSQL, fake identities and fake gym names only**.

## High-priority release controls

- The production `main` branch is currently unprotected. Require PRs, a second reviewer where possible, required checks, no force push, no direct main write and explicit owner approval.
- The existing GitHub Pages workflow is automatic for `main`. Never add a branch pattern to the deployment path that might accidentally publish a pilot feature.
- No service-role or AI keys may enter the browser `VITE_*` variables, committed files, actions logs or screenshots. A publishable Supabase key is not a secret but does not replace RLS.
- Hard-delete UI uses a simple warning, not typed member confirmation, while the backend enforces owner permission and protection of financial records. Confirm owner policy before changing UX again.
- Password reset and email confirmation flows exist in source; verify live Supabase redirect/SMTP and password-protection settings *in the dashboard* before relying on them.

## Action plan (no production schema changes)

1. Prioritize a source-level checklist for every privileged function, including effective grants, `auth.uid()`, `private.require`, and `gym_id` scoping.
2. Expand the isolated Test Gym A/B suite for malformed foreign IDs, concurrent calls, unknown JWTs and authorization bypass attempts.
3. Propose any security migration only on a separate feature branch; attach affected RPC risk assessment, tests and reverse/forward-fix steps.
4. Re-run Supabase security/performance advisers in read-only mode after a future **owner-approved** release.

**Release recommendation: HOLD.**
