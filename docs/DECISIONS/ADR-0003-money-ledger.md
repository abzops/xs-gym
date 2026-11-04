# ADR-0003 — Money ledger in integer paise

**Status:** Proposed · 05 Nov 2026

**Context.** Blueprint requires exact money, immutable history and outstanding
dues, but defines only payments (audit B2).

**Decision.** `bigint` paise everywhere. Ledger of `charges` (owed),
`payments` (received), `payment_allocations` (which payment settles which charge,
oldest due first) and `payment_reversals` (full reversal with reason). Dues and
report totals are computed, never stored. No updates or deletes on ledger rows.
Partial refunds deferred to P1.

**Consequences.** Dues are always explainable row by row. Correcting an amount
means reverse + re-record, which staff must be trained on.
