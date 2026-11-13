# XS Gym — Payment Ledger and Membership Correctness Review

**Prepared:** 2026-11-11 | **Environment:** source review and disposable synthetic test database only  
**Production billing changes:** NONE | **Owner decision confirmed 2026-11-11:** paid charge void does not cancel membership

## 1. Ledger model (observed)

Authoritative values are integer **paise** in PostgreSQL. Browser/UI/AI output must never be the source of financial totals.

| Stage | Current implementation | Invariant / evidence |
|---|---|---|
| Sell membership | `public.sell_membership` creates `member_memberships` and charge(s); enforces `memberships.sell` and idempotency key | [commands.sql](https://github.com/abzops/xs-gym/blob/main/supabase/migrations/20261104194332_commands.sql) |
| Record payment | `public.record_payment` creates immutable payment, allocates credit oldest-first, records audit; rejects nonpositive or >100000000 paise | Same code; tested in [test_core.sql](https://github.com/abzops/xs-gym/blob/main/tests/db/test_core.sql) |
| Allocate payment | `payment_allocations` is immutable; constraint trigger checks allocation against open charges / unreversed payment | [operations.sql](https://github.com/abzops/xs-gym/blob/main/supabase/migrations/20261104194208_operations.sql) |
| Partial payment | Remaining charge balance is positive dues | Synthetic DB tests cover partial and fully allocated payments |
| Overpayment | Unallocated payment appears as member credit | Synthetic DB tests cover an excess payment becoming credit |
| Reverse payment | `reverse_payment` inserts `payment_reversals` and an audit event; original payment record remains immutable | Double reversal and authorization tests already exist |
| Correct payment | `correct_payment` reverses original and creates a replacement inside a single database transaction using a separate idempotency key | [payment_corrections.sql](https://github.com/abzops/xs-gym/blob/main/supabase/migrations/20261111102608_payment_corrections.sql); retry tests exist |
| Void charge | `void_charge` sets status to void and releases allocations on voided charges to payment credit | Existing membership period status is not changed |
| Renew | `sell_membership` extends from old end when within grace, else starts today, unless explicit authorized start override | Tests cover renewal from prior period and inclusive date rules |
| Reports | `daily_report`, `dashboard_summary`, `gym_analytics` present collection/reversal/net totals | Tests compare reporting totals to raw nonreversed payment sums |

## 2. Owner-confirmed business policy (RESOLVED 2026-11-11)

**Observed code behavior:** A member pays for a plan, the charge is subsequently voided, and the existing membership remains active. The allocated payment is released as credit. This is independently asserted in the new synthetic regression test on `feature/pilot-safety-audit`.

**Owner has selected option 3 below (separate operations):**
1. **Preserve access (current):** voiding financial charge leaves membership active; requires a clear warning that service remains active.
2. **Cancel membership too:** void charge and end access together, with reason and an auditable membership cancellation event.
3. **Separate actions (APPROVED POLICY):** void charge changes only ledger; an authorized user must separately cancel/adjust membership access with an explicit confirmation and status display.

Do **not** change this behavior automatically or reinterpret historical customer records to match a new rule.

## 3. Test coverage and gaps

| Scenario | Evidence / status |
|---|---|
| Zero, negative and out-of-range payments | Existing SQL guard; synthetic zero/negative regression added on audit branch, requires CI evidence |
| Same idempotency key repeated | Existing synthetic database test passes; duplicate payment not inserted |
| Same key, different payment amount | Existing test expects XS409 |
| Partial payments, overpayment/credit, reversal | Existing synthetic tests cover expected balances |
| Cross-gym payment creation and correction | Existing synthetic tests assert XS403 |
| Reception cannot reverse/correct | Existing synthetic tests assert XS403 |
| Paid charge void preserves history, creates credit, retains access | New synthetic regression **written**; owner policy unresolved |
| Parallel/concurrent idempotency races | **NOT PROVEN** with overlapping transactions |
| Reconciliation across report ranges and month boundaries | Daily/analytics synthetic checks exist; more date ranges and cutoffs needed |
| Gateway-confirmed UPI/card receipts, refunds, webhooks | **NOT IN SCOPE / NOT VERIFIED**; existing methods are manual entries |
| Double-submit on slow networks and mobile crash/retry | E2E coverage exists for UI; fault-injection/reconnect scenarios remain |
| Production collection accuracy for CHAOS COMBAT | No write/read of individual customer transactions authorized; pilot currently has zero recorded payments at aggregate inspection |

## 4. Proposed follow-on tests (isolated only)

- Concurrent payment submissions with the same idempotency key, contrasting retries with identical vs different method/reference/member; assert exactly one payment.
- Payment correction collision between reversal/replace and a simultaneous second correction; assert audit and amount invariants.
- Gym-local midnight, daylight/timezone, leap-day and month-end reconciliation.
- Unknown/wrong-gym payment ID with a valid role; zero leaked read/write across tenants.
- Paid/unpaid charge void and reconciliation of active dues + credit; independently check membership visibility after void.
- Crash injection after payment insert and before allocation; transaction must roll back or retry idempotently.
- Currency/round-trip boundaries for paise, overflow and cumulative allocation limits.
- Periodic read-only reconciliation report comparing sums to materialized UI metrics (use only synthetic data until owner approves pilot reconciliation).

## 5. Required approval gate

Only a **proposed** code/test change may live on a feature branch. Changes to ledger, money, membership access, financial retention or live corrections require owner approval, a restorable backup and a tested rollback/forward-fix.

**Release recommendation: HOLD; policy resolved. Next work is further isolated concurrency tests and review of a future UI warning, not an automatic backend membership cancellation.**
