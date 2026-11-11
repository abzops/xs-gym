# XS Gym — Privileged database RPC review (all 24 public overloads)

**Date:** 11 November 2026  
**Scope:** PostgreSQL production metadata and source read-only; no RPC execution or customer rows.  
**Outcome:** 24/24 privileged API overloads **source-reviewed**, not penetration-tested. **No production changes.**

## Shared verification (read-only SQL)

All 24 routines are `SECURITY DEFINER`; all have explicit empty `search_path` and can be EXECUTEd by authenticated sessions, but not by `anon`. SQL code in each routine was inspected using `pg_get_functiondef()`. The permission helper `private.require(gym, permission)` verifies a signed-in user, an active `gym_staff` role permission for the *requested gym*, and an active/trial subscription. The `private.has_permission` helper also verifies staff membership by `auth.uid()`. This is a useful baseline **but does not prove there are no cross-tenant or business-logic vulnerabilities**.

## Individual RPC review

| # | Public RPC | Guard found in live source | Tenant/object protection observed | Assessment / follow-up |
|---:|---|---|---|---|
| 1 | `cancel_membership` | `memberships.cancel` | Update filters gym and membership ID | Explicit reason + audit; test cancellation/charge-credit separation |
| 2 | `check_in` | `attendance.checkin`, `attendance.override` for exceptional cases | Member lookup by both gym and member | Duplicate day checks; race under simultaneous check-in remains to test |
| 3 | `complete_onboarding` | `gym.settings` | Update by gym ID after authorization | Check repeat/no-op audit semantics |
| 4 | `correct_payment` | Both `payments.reverse` and `payments.record` | Original and replacement bound to gym; locks original payment | Original retained; retry handling; two-corrector race needs load testing |
| 5 | `create_gym` | Direct non-null `auth.uid()` plus one-gym-per-creator check | New gym owned by caller | Check concurrent duplicate account creation; metadata is only used for display |
| 6 | `create_member` | `members.write` | Inserts with authorized gym ID; checks active phone duplicate | Unique-index race and import retry; currently no durable import batch ID |
| 7 | `daily_report` | `reports.financial` | Aggregates filter by requested gym | Cross-gym and time-zone boundary tests pending |
| 8 | `dashboard_summary` | `reports.operational` + conditional `reports.financial` | Results filter by requested gym | Non-finance role should never receive financial fields |
| 9 | `gym_analytics` | `reports.financial` | Analytics queries filter by requested gym | Month range capped; verify every subquery and large-range performance |
| 10 | `permanently_delete_member` | `members.archive` plus explicit owner-only active staff check | Locks gym-scoped target and rejects linked financial/membership/attendance rows | Critical deletion audit and cross-tenant tests; client has warning-only confirm |
| 11 | `record_expense` | `expenses.record` | Expense/category created inside gym | **Gap:** existing idempotency key retry returns record without verifying changed request values |
| 12 | `record_payment` | `payments.record` | Gym-scoped member check; immutable payment | **Gap:** retry with same key/member/amount but different method/reference returns original silently; report mismatch |
| 13 | `reverse_expense` | `expenses.reverse` | Gym-scoped expense lookup | Reversal audit; double-reversal protected; concurrency test pending |
| 14 | `reverse_payment` | `payments.reverse` | Gym-scoped payment lookup | Audit and double-reversal guard; concurrency race requires testing |
| 15 | `save_enquiry` | `members.write` | Gym-scoped row update; composite FK `(gym_id,member_id)` verified | Cross-gym joined-member FK should block references; test malformed status changes |
| 16 | `save_plan` | `plans.manage` | Gym-scoped plan update | Price/date constraint tests, role segmentation |
| 17 | `save_staff` | `staff.manage` | Staff row keyed by gym+user; rejects owner role & self-edit | Role escalation, cross-gym invite and email enumeration testing |
| 18 | `sell_membership` | `memberships.sell`, plus `discounts.apply` if discounted | Both member and plan queried by gym; tenant FKs verified | Concurrent renewals and idempotency key payload mismatch testing |
| 19 | `set_member_status` | `members.archive` | Gym-scoped member update | Active/archived validation and audit; concurrent restored phone uniqueness |
| 20 | `update_gym_settings` | `gym.settings` | Authorized gym ID updated | Subscription settings and validation tests |
| 21 | `update_member` legacy overload | `members.write` | Gym-scoped member lookup and update | Old clients must preserve joining date, uniqueness checks |
| 22 | `update_member` joining-date overload | `members.write` and calls legacy updater | Both updates gym-scoped within one transaction | Date audit; membership periods should not change |
| 23 | `void_charge` | `charges.void` | Gym-scoped charge update | Confirm paid-charge credit and **separate** membership access rule; no automatic cancellation |
| 24 | `void_check_in` | `attendance.correct` | Gym-scoped event update | Requires reason, audit, prevents duplicate void |

## Additional tested invariants

The existing synthetic database test covers role isolation across two gyms, receptionist payment restrictions, trainer read restrictions, wrong-gym record creation/correction, immutability and owner-only member deletion. Additional metadata regressions on this feature branch assert: **exactly 24** privileged RPC overloads, **zero anonymous EXECUTE grants**, and explicit function `search_path` on all 24.

## Severity-ordered findings

**HIGH — Idempotency mismatch semantics:** `record_payment` checks only member and amount before returning an existing payment. Identical UUID with different method/reference may be interpreted as a successful correction without recording the change. No new entry is inserted, but UI confirmation can be misleading. `record_expense` has a similar unchecked retry payload. Propose separate migration and synthetic tests; **not applied**.

**HIGH — Financial/access split:** `void_charge` releases paid allocation to credit while a membership remains active. The owner has **confirmed** that cancelling access must be a separate explicit command. No current backend change is required, but UI warnings and ledger reconciliation tests remain.

**HIGH — Concurrent transaction behavior:** Postgres unique keys and locks cover several calls, but parallel idempotent retries, simultaneous membership sales, double-reversal attempts and `apply_credit` allocation behavior need deterministic two-session tests. Do not claim stress-test clearance from sequential tests.

**HIGH — Hard deletes:** A never-transacted profile can be deleted; linked financial/member history is blocked. Separate administrative bulk-clearing procedures and backup recoverability must never bypass the approved protection guide.

**MEDIUM — Read RPC and onboarding:** Financial access is checked via `private.has_permission` in read routines. `complete_onboarding` and `update_gym_settings` use `private.require`. Validate after-expiry read-only and report presentation on a synthetic browser.

**MEDIUM — Configuration:** Advisor flags 24 deliberate exposed definer overloads and leaked-password protection. These are warnings, not proof of 24 exploitable bugs; verify live Auth settings manually under separate approval.

## Release stance

This is a **static/read-only function review only**. Source reasoning must be followed by isolated negative-role tests and concurrency tests. Any fixes require a distinct small feature PR, a fresh restorable backup and explicit owner approval to release.

**Release: HOLD.**
