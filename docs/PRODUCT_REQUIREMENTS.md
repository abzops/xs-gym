# XS Gym — Product Requirements (P0 draft for Phase 1 validation)

Scope and priorities come from blueprint §2. This turns P0 into testable stories.
Everything here is a hypothesis until the pilot gym confirms it in Phase 1.

## 1. Top daily tasks (to validate by observation)

1. Check a member in. 2. Record a payment. 3. Renew a membership. 4. Add a new
member. 5. See who expires this week. 6. See today's collections. 7. Look up a
member's status and dues. 8. Record an expense. 9. Correct a mistake. 10. Close
the day (cash vs UPI totals).

Speed targets: check-in ≤ 3 taps from the home screen; payment ≤ 5 taps plus
amount entry; new member ≤ 60 s with name and phone only.

## 2. P0 user stories and acceptance criteria

**Members**
- *As reception, I add a member with name and phone.* Phone normalised to E.164;
  duplicate active phone in the same gym is blocked with a link to the existing
  member; member number assigned by the server; optional fields can be skipped.
- *As reception, I find a member by name, phone or member number.* Results start
  after 2 characters; partial phone matches work; archived members hidden unless
  filtered.
- *As owner, I import members from CSV.* Preview, per-row validation, duplicate
  report and explicit confirm before anything is saved; import is audited.

**Plans and memberships**
- *As owner, I create plans* (name, duration in days or months, price in ₹).
- *As reception, I sell or renew a plan.* End date computed by the server (D-03);
  renewal start follows D-04; price snapshot and a charge are created in the same
  transaction; discount needs permission and a reason.
- *As manager, I freeze or cancel* (if D-12 allows), with reason, audited.

**Attendance**
- *As reception, I check a member in.* Status (active/grace/expired/frozen) and
  dues shown before confirming; server timestamp; duplicate and expired rules per
  D-07; corrections by manager with reason, original kept.

**Payments**
- *As reception, I record a payment* (cash/UPI/other), with optional reference.
  Saved only on server confirmation; double tap creates one payment; UPI labelled
  "manually verified"; receipt viewable and shareable.
- *As manager, I reverse a payment* with a reason; original stays visible.
- *As owner, I see dues per member* and a gym-wide outstanding list.

**Expenses**
- *As manager, I record an expense* with category, amount, date and method;
  corrections by reversal.

**Dashboard and reports**
- Dashboard shows the metrics in §3 with date, timezone and definitions one tap away.
- Reports: daily and monthly collections, expenses, dues, expiry list, new
  members, attendance, payment history; filters shown; CSV export with permission.

**Platform**
- Every important action appears in the audit log (blueprint §2.12).
- Works on all devices in `TEST_PLAN.md` §6. Loading, empty, error and offline
  states on every screen.

## 3. Metric dictionary

All dates are gym-local (`Asia/Kolkata` by default).

| Metric | Definition |
|---|---|
| Active members | Members with a membership whose status today is `active` or `grace` |
| Expiring today / 7 / 30 days | Memberships with `effective_end_date` between today and today + N − 1, member not renewed (no later membership) |
| Today's attendance | Non-superseded check-ins with gym-local date = today |
| Collections (range) | Σ payments by `received_at` in range, **before** reversals |
| Reversals (range) | Σ reversed payment amounts by reversal date in range |
| Net collections | Collections − reversals |
| Cash / UPI split | Collections grouped by method |
| Outstanding dues | Σ open charges − Σ allocations from non-reversed payments, members with balance > 0 |
| Expenses (range) | Σ non-reversed expenses by `expense_date` |

## 4. Phase 1 discovery kit

**Owner interview:** current tools (register, Excel, another app?); plans and
prices; admission fee; discounts; renewals early/late; grace days; freezes;
refunds; payment methods; daily cash handling; expense categories; staff and
their duties; devices; what is most painful today; what reports they want.
(Answers fill D-02, D-04, D-07, D-08, D-12.)

**Receptionist interview and observation:** walk through a busy hour; time each
check-in and payment; note interruptions, lookups and paper use; which language
staff and members use; phone/tablet handling.

**Outputs:** confirmed top-10 tasks with timings; final P0 stories; responsive
wireframes for each task at phone, tablet portrait, tablet landscape and laptop;
click-through prototype for owner sign-off.

## 5. Out of scope for the first release

Blueprint §23: biometrics, accounting/ERP, payroll, bank reconciliation, native
apps, wearables, multi-branch, medical advice, autonomous financial actions,
workflow builder, unlimited free AI/voice.
