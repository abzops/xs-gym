# Owner Decisions

Business rules and account details that cannot be inferred. Each lists options, a
recommendation and the phase it blocks. Record the answer and date in the
**Decision** line; move decided items to the bottom section.

## Open

### D-02 — Pilot gym profile and access · blocks Phase 1

Gym name, address, phone, operating hours, number of staff by role, devices at the
front desk (phone, tablet, laptop), approximate active members. Can we interview
the owner and a receptionist, and observe one busy hour?
**Decision:** _pending_

### D-03 — Membership end-date rule · blocks Phase 2

| Option | Rule | 15 Jan + 1 month | 31 Jan + 1 month | 1 Mar + 1 month |
|---|---|---|---|---|
| **A (recommended)** | End date is the **last valid day** (inclusive). End = start + N months − 1 day; if the start day does not exist in the target month, end = last day of that month. | 14 Feb | 28 Feb (29 in leap year) | 31 Mar |
| B | "Valid until" date is the **first day it is no longer valid** (exclusive). | 15 Feb | 28 Feb | 1 Apr |

Option A matches how receipts usually read ("valid till 14 Feb"). Day plans
(e.g. 15-day trial) use start + N − 1.
**Decision:** _pending_

### D-04 — Renewal start date · blocks Phase 2

| Option | Rule |
|---|---|
| **A (recommended)** | Renewed before expiry or within the grace period → new period starts the day after the old end date (no lost or free days). Renewed after grace → starts on the renewal date. Manager can override with a reason (audited). |
| B | New period always starts on the payment date. |
| C | New period always continues from the old end date, however late. |

Also: how many **grace days** after expiry (0, 3, 5, 7)?
**Decision:** _pending_

### D-05 — Staff sign-in method · blocks Phase 3

| Option | Cost | Notes |
|---|---|---|
| **A (recommended)** Email + password per staff member | Free | Works on shared tablets; every action is attributed to a person. Staff without email need one (a free Gmail is fine). |
| B Magic link by email | Free | Awkward on a shared front-desk tablet (must open email there). |
| C Phone OTP by SMS | Paid per SMS (provider account needed) | Most familiar for staff in India; adds a recurring cost and a provider dependency. |

Shared logins are not supported in any option (they break the audit trail).
**Decision:** _pending_

### D-06 — What happens when the trial or subscription expires · blocks Phase 2

**A (recommended):** tenant becomes **read-only** — staff can view and export all
data and reach billing, but cannot add, edit, check in or record payments.
B: full lock-out except export and billing.
Data is never deleted at expiry in either option.
**Decision:** _pending_

### D-07 — Attendance rules · blocks Phase 2

1. Second check-in by the same member on the same day: allow / warn / block?
2. Member whose membership has expired (past grace) or is frozen: warn / block / block with manager override?
3. Is check-out needed? (Blueprint: P1, optional.)
**Decision:** _pending_

### D-08 — Member numbers · blocks Phase 2

New member ID format (proposal: `XS-` + 4-digit sequence per gym, e.g. `XS-0001`).
Does the gym have existing register numbers to keep when importing?
**Decision:** _pending_

### D-12 — Fees, discounts and money policies · blocks Phase 2

1. Plans and prices (name, duration, price) the gym sells today.
2. One-time admission/registration fee? Amount?
3. Who may give a discount, and is there a maximum?
4. Freeze/hold allowed? Maximum days per membership?
5. Refunds ever given? Who approves?
6. Payment methods accepted (cash, UPI, card, bank transfer)?
7. Expense categories used today.
8. Personal training sold separately? (Blueprint: P1.)
**Decision:** _pending_

### D-10 — Brand derivations · blocks Phase 3 (design tokens)

1. Approve restrained **functional status colours** (success, warning, danger, info) for states only, always paired with an icon and text. The Xelorsoft palette stays monochrome.
2. Approve exporting a **maskable PWA icon** from the SVG master (badge scaled into Android's safe zone).
3. Heading weight: the guide's text says Manrope **SemiBold**; the guide's PDF renders ExtraLight. Use SemiBold?
4. Are the original SVG masters available? If not, the recovered ones become official.
**Decision:** _pending_

### D-13 — Supabase projects · blocks Phase 3

Create two Supabase projects under a Xelorsoft-owned account: `xs-gym-staging` and
`xs-gym-prod` (Free allows 2). Region: Mumbai (`ap-south-1`) for latency. Share
project URLs and publishable keys only; secret keys go into GitHub Actions secrets
directly, never into chat.
**Decision:** _pending_

### D-09 — Backups before go-live · blocks Phase 10

Supabase Free has **no backups** and pauses after 1 week of inactivity (verified
05 Nov 2026).
**A (recommended):** Supabase Pro (from $25/month, daily backups kept 7 days) for
production from go-live. B: stay on Free with nightly encrypted `pg_dump` from
GitHub Actions to private off-site storage, plus a monthly restore drill.
**Decision:** _pending_

### D-14 — Domain · blocks Phase 10

Who controls DNS for `xelorsoft.com`? Access is needed to add a `CNAME` for
`gym` → `abzops.github.io` and a GitHub Pages domain-verification `TXT` record.
**Decision:** _pending_

## Assumed so the build could continue (05 Nov 2026)

The owner asked to build end to end without stopping. These recommended options
are now **implemented**; each can be changed later with a small migration.

| Decision | Assumed | Where it lives |
|---|---|---|
| D-03 end date | Option A: inclusive last day, calendar months, month-end clamp | `private.membership_end_date` |
| D-04 renewal start | Option A: continue after old end if within grace, else today; staff may pick a date 30 days back to 60 days ahead | `sell_membership` |
| D-04 grace days | 3 (owner can change 0–60 in Settings) | `gyms.grace_days` |
| D-05 sign-in | Email + password per person; staff sign up, then the owner adds them | `save_staff` |
| D-06 expiry | Read-only: view and export stay available, writes blocked | `private.can_write` |
| D-07 attendance | One check-in per day; expired or no plan needs a manager override with a reason (audited) | `check_in` |
| D-08 member numbers | `XS-0001` sequence per gym; legacy numbers not yet supported | `private.next_member_no` |
| D-10 brand | Functional status colours used for states only; transparent logo variants derived from the SVG | `src/styles/app.css`, `public/brand/` |
| D-12 money | Admission fee optional at first sale; discounts by owner/manager with a reason; methods cash, UPI, card, bank, other; no refunds (reverse and re-record instead) | `sell_membership`, `record_payment` |
| D-13 Supabase | One project `xs-gym` (ref `knuanihnxtxtyrgvsumq`, Mumbai, Free plan) used as production. No staging project yet | — |
| D-15 trial start | Trial starts when the owner creates the gym (not on Xelorsoft activation); one gym per account | `create_gym` |

## Decided

### D-01 — Frontend hosting · decided 05 Nov 2026

**Decision:** GitHub Pages, repository `abzops/xs-gym` (owner instruction).
Consequences accepted and handled in ADR-0005: repo must be public on GitHub Free;
security policy delivered by `<meta>` CSP (no `frame-ancestors`, HSTS or
`Permissions-Policy` headers); deep links served via a `404.html` fallback.
A Cloudflare proxy can be added later for headers without changing hosting.
