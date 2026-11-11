# XS Gym — Owner-approved financial/access separation

**Owner decision:** 11 November 2026  
**Status:** Business policy CONFIRMED; existing implementation unchanged; synthetic regression added  
**Production payment/member changes:** NONE

## Owner's exact policy

> Voiding a paid charge must not automatically cancel membership access. Financial corrections and membership cancellation are separate operations.

This supersedes the former *open* policy question in early handover notes. A charge void must **never silently terminate access**; a membership cancellation must **never silently refund or reverse a payment**.

## Authoritative accounting treatment (INR integer paise)

| Event | Payment | Open charge / dues | Credit | Membership access |
|---|---|---|---|---|
| Sell plan ₹1,000 | none | ₹1,000 due | ₹0 | Active if plan effective |
| Receive ₹1,000 | ₹1,000 immutable recorded | ₹0 due (payment allocated) | ₹0 | Unchanged |
| Void paid charge separately | Original payment/receipt remains; **not reversed** | Charge marked void; ₹0 due | ₹1,000 unallocated credit | **Still active** |
| Explicitly cancel membership with reason | Original payment still recorded | Same charge/credit as before | ₹1,000 | Cancelled only by separate authorized action |
| Separately reverse/refund payment | Reverse event and audit, not hard delete | Balance recalculated | Removed/reduced accordingly | Unchanged unless separately cancelled |

Amounts illustrative and synthetic; **not live customer transactions**. For partial payments, voiding the charge turns the previously allocated paid portion into credit, not an automatic refund. The original receipt and allocation history stay available for reconciliation; open charges must exclude voided charges, and reversal entries must be deducted from net collections.

## Existing code observed

- `public.void_charge` changes charge to `void` with reason and calls `private.apply_credit`. It does **not** call `cancel_membership`.
- `public.cancel_membership` changes `member_memberships.status` to `cancelled` and writes its own reason/audit; it does **not** call `void_charge` or `reverse_payment`.
- `public.reverse_payment` creates an immutable reversal event and rebalances credit.
- `public.member_overview` calculates dues/credit from open charges and unreversed payments.
- `public.correct_payment` reverses and replaces a payment with an idempotency key; does not change membership access.

The owner decision matches the current separation in source. **No production migration or new accounting rule has been applied.**

## Required product safeguards before the next live financial UX release

1. Paid-charge void confirmation explicitly says: **“Payment becomes member credit. Membership access stays active. Cancel membership separately if required.”**
2. Membership cancellation confirmation separately says: **“Membership access ends; this does not refund, void a charge or reverse payment. Handle financial corrections separately.”**
3. Credit and due badges must reconcile to the ledger in paise; receipts and original payments are immutable.
4. Every operation must record actor, reason, transaction identifiers, prior/new state and idempotency key where applicable.
5. Cash refunds, refund liabilities and negative balances require a separate explicit policy; do not present a void as a cash refund.
6. Test full/partial paid voids, overpayment, late reversal, expired plan, simultaneous corrections and wrong-gym unauthorized calls with synthetic tenants.

## Isolated verification

Existing unit/database tests cover basic payment/charge reversal and report totals. On `feature/pilot-safety-audit`, added a synthetic membership charge paid at ₹1,000; void confirms ₹1,000 credit and unchanged access. A separate explicit `cancel_membership` is then invoked with a reason; it must cancel the membership but retain original payment and credit, and produce a separate audit event. **Check the feature-branch CI result for final pass status.**

## Remaining owner decision

A paid charge void is not a cash refund. The policy for **actual cash/UPI refunds**, bank settlement, tax invoice cancellations and unused member credit needs a separate finance decision before automated refunds are implemented.

**Release: HOLD until approved follow-on UI PR, security test and recoverable backup evidence.**
