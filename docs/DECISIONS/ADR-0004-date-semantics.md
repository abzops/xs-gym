# ADR-0004 — Membership date semantics

**Status:** Proposed — pending owner decisions D-03 and D-04 · 05 Nov 2026

**Context.** End-date convention, month-end handling and renewal start are
undefined in the blueprint (audit B3, B4).

**Decision (proposed).** Membership dates are `date` values in gym-local time.
End date is the inclusive last valid day; month plans use calendar months with
month-end clamping; day plans use start + N − 1. Renewal continues from the old
end if within grace, else from the renewal date; manager override audited. The
reference function and 13 test vectors are in `DATABASE.md` §5 and pass on
PostgreSQL 16.

**Consequences.** Receipts read naturally ("valid till 14 Feb"). If the owner
picks a different option, only `private.membership_end_date` and its test
vectors change.
