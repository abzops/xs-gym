# XS Gym — Progress and Handover Log

> **Read this first in every new session.** It records exactly where the work
> stands, what is blocked, and the next concrete step. Update it in the same
> commit as the work it describes. Newest log entry at the top of section 6.

## 1. Current position

| | |
|---|---|
| Phase | **P0 core operations built and deployed** (Phases 3–4 compressed at owner's request) |
| Live app | <https://abzops.github.io/xs-gym/> — served from `gh-pages`, updated by CI on every push to `main` |
| Backend | Supabase project `xs-gym`, ref `knuanihnxtxtyrgvsumq`, region `ap-south-1`, Free plan |
| Database | 3 migrations applied (`supabase/migrations/`), 16 tables, RLS on all |
| CI | `.github/workflows/pages.yml`: typecheck, lint, unit tests, DB tests on PG16, secret scan → `gh-pages` |
| Remote | `https://github.com/abzops/xs-gym`, branch `main`; commits authored as `abzops` |
| Last updated | 05 Nov 2026 |

## 2. Rules for whoever continues

1. The spec is `docs/source/XS_Gym_End_to_End_Engineering_Blueprint.md`. Follow its §0 instructions.
2. Small commits, `type: summary`. No attribution or tool trailers in commits. Author is `abzops <87251316+abzops@users.noreply.github.com>`.
3. Push after every few commits. Update this file in the same commit as the work.
4. Never commit secrets, `.env*` (except `.env.example`), dumps or real member data.
5. Every database change: new migration file → run `PG_RUN_AS=<non-root user> bash tests/db/run.sh` → apply to Supabase → run security advisors.
6. All writes go through command functions (ADR-0002). Money is integer paise (ADR-0003).

## 3. Blockers and owner actions

| # | Item | Owner action | Status |
|---|---|---|---|
| X5 | Pages publishes `main` source, so the site is blank. Each push to `main` republishes the raw source. | Settings → Pages → Source: **GitHub Actions** (or Deploy from a branch → `gh-pages` / root) → Save. CI publishes both ways. | **Resolved** 05 Nov 2026 |
| X6 | Supabase Auth Site URL is the default, so email links (confirm, reset) redirect to localhost. | Supabase → Authentication → URL Configuration: Site URL `https://abzops.github.io/xs-gym/`; add the same to Redirect URLs. | Open |
| X7 | Supabase's built-in email only delivers to members of the Supabase organisation and is rate-limited. Staff sign-ups may never get a confirmation email. | Either set up custom SMTP (e.g. a free transactional email account) or, for the pilot only, turn off "Confirm email" in Authentication → Providers → Email. | Open |
| X8 | Free plan: no backups, pauses after 1 week idle (D-09). | Upgrade to Pro before real member data, or approve scheduled encrypted dumps. | Open — before go-live |
| X2 | Build workspace cannot reach Supabase or github.io from the shell. | None needed: CI runs DB tests; Supabase changes go through the connector. | Workaround |

## 4. Done

| Item | Where |
|---|---|
| Phase 0 audit, plan, design docs, ADRs, decisions register | `docs/` |
| Supabase project created and 3 migrations applied; security advisor clean except expected definer-function notice | Supabase `xs-gym` |
| Database tests: 67 checks (dates, tenancy, permissions, money, attendance, immutability, reports, expiry, anon) | `tests/db/` — pass locally and in CI |
| Live smoke test on production DB in a rolled-back block: sell → pay → idempotent retry → check-in → dashboard → cross-tenant block | 0 rows left behind |
| Unit tests: money (incl. 2,858-amount round trip), dates, CSV export injection, CSV import parsing | `src/lib/*.test.ts` — 39 pass |
| App: sign-in/up/reset, gym setup + trial, dashboard, check-in, members (list/add/edit/archive), sell/renew, payments (record/reverse), charges (void), plans, expenses (record/reverse), reports (daily, dues, expiring, CSV), settings (gym, staff, subscription) | `src/` |
| Payment receipts: print, share (WhatsApp/SMS via share sheet or copy), opened after each payment | `src/features/payments/ReceiptPage.tsx` |
| Member CSV import: template, preview, per-row validation (name, phone, dates day-first, duplicates), results | `src/features/members/ImportPage.tsx` |
| Responsive check: 11 screens × phone/tablet/tablet-landscape/laptop, no overflow, no console errors | `tests/ui/screens.mjs` |
| Security: strict CSP meta, anti-framing, no secrets in bundle (CI scan), RLS on all tables, anon has no grants | |

## 5. Next steps (in order)

1. Owner: X5, X6, X7. Then sign up at the live URL, create the gym, add plans.
2. Pilot onboarding: add real plans, a few members, try a day of check-ins and payments; collect feedback.
3. P0 gaps still open: membership freeze; audit log viewer; staging Supabase project; CI job running
   the real Supabase stack; sequential receipt numbers (currently derived from the payment ID).
4. Phase 5: PWA service worker + offline indicator, maskable icon, axe accessibility pass.
5. Phase 8: trial expiry reminders, manual verified payment activation by Xelorsoft.
6. Phases 6–7 (AI text and voice) only after the pilot uses the core daily.

## 6. Session log

### 2026-11-05 — Session 1 (continued)

- Owner asked to build end to end; recommended options applied and recorded as "Assumed" in `docs/OWNER_DECISIONS.md`.
- Created Supabase project `xs-gym` (Mumbai, $0). Wrote and applied migrations: foundation, operations, commands.
- Local DB tests caught a real bug (allocation guard counted reversed payments); fixed before deploying.
- Built the React app (Vite 8, React 19, TypeScript 7 strict, TanStack Query, React Router 8).
- Pushing `gh-pages` auto-enabled Pages, but the existing Pages source is `main` → blank page (X5).
- Rewrote early history so all commits are authored by `abzops`; no tool attribution anywhere.
- Added receipts and CSV import; CI now also publishes through the Pages deployment API.
- Owner set Pages source to `gh-pages`; site live.
- Premium redesign: Carbon sidebar and Today band, split sign-in, adaptive transparent favicon,
  logo rule (black on light, white on dark), design rules from taste-skill and emilkowalski/skills (ADR-0007).

### 2026-11-05 — Session 1

- Phase 0: inspected supplied files (greenfield), recovered SVG masters, wrote audit, plan, design docs and ADRs.
