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

### 2026-11-05 — Session 5 (iOS PWA microphone permission)

- Diagnosed installed iOS XS AI microphone banner: the client called
  `SpeechRecognition.start()` directly, and incorrectly treated both
  `not-allowed` and `service-not-allowed` as microphone OS denial.
- Added an in-app, mobile-responsive microphone onboarding dialog. The
  user-triggered Allow button calls `getUserMedia` to invoke native permission,
  releases the temporary capture tracks, and automatically tries recognition.
- Denied microphone, unavailable hardware, and speech-service errors have
  distinct recovery states with an in-app Retry and keyboard/dictation fallback.
  A permanent iOS denial cannot be bypassed by browser code.
- Added regression tests for permissions and for phone/laptop UX in light/dark;
  real installed-iPhone confirmation is still required. No Supabase backend
  functions or database permissions were changed.

### 2026-11-05 — Session 4 (repair NVIDIA model retirement)

- Confirmed from production logs at 15:54Z: the former NVIDIA model returned 410 and xAI Grok returned 403.
- NVIDIA now tries currently catalogued GPT OSS 20B, Nemotron 3.5 Lightning and GLM 5.3 Flash models before switching providers; optional NVIDIA_MODEL is tried first.
- Key-wide denials and provider rate limits skip sibling NVIDIA models; model retirement still falls through to the next candidate.
- Added a permission-checked, RLS-protected read-only response for the exact question "Who has dues?" even without AI keys.
- Added unit and local E2E regression checks. xAI 403 still requires checking model access, team permissions and API billing in xAI Console.
 
### 2026-11-05 — Session 3 (provider failover)

- XS Supabase logs confirm user, gym and role checks succeed; provider error 403 triggers an XS AI failure.
- Added NVIDIA NIM → xAI Grok → optional OpenAI-compatible inference failover within each model step, without replaying completed database tools.
- Added deterministic CI tests for upstream 403, 429, invalid responses, all-provider failures and retained tool results.
- Owner must add `NVIDIA_API_KEY` and `XAI_API_KEY` as Supabase Edge Function Secrets for project `knuanihnxtxtyrgvsumq`. Neither key belongs in client-side code.

### 2026-11-05 — Session 2 (voice reliability)

- Prevented rapid double submissions of XS AI commands and Undo actions with synchronous guards.
- XS AI stops listening as soon as sheet dismissal begins; partial speech cannot submit a command after Close.
- Cancelling voice output always settles its promise (with a stalled-speech watchdog), preventing a stuck UI.
- Added phone/laptop, light/dark regression checks for duplicate sends, Undo and dismissal mid-speech.
- Supabase project `knuanihnxtxtyrgvsumq` is not available through the linked account in this session; no backend changes were made.

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
- Native-app pass: data router with View Transitions (push/pop/tab), swipe-to-dismiss sheets with exit
  animation, sliding segmented control, smooth field collapse on sign-in, frosted iOS-style tab bar
  (< 720 px), Carbon icon rail (720–1099 px, fixes tablet), sidebar (≥ 1100 px), round icon actions on
  phone headers, non-essential copy removed. UI checks now cover 6 sizes incl. iPad + a phone flow.
- Known: first-load JS is ~185 KB gzip (budget 170 KB) after the data router; trim in a later pass.
- Landing page for signed-out visitors at `/` (signed-in users go straight to their gym); `/login?mode=signup` opens sign-up.
- Scrollbars hidden on touch devices and in the installed app; normal on laptops.
- UI suite: 79 checks — landing, sign-in and 11 app screens at 6 sizes (phone, tablet, iPad, both landscapes, laptop) + phone flow.
- Demo scripts in `scripts/demo/` (seed a full demo gym; reset a login). Seed tested on local PG16.
- Password reset of an existing account via SQL was blocked by a safety check; owner resets via Supabase → Authentication → Users.
- Owner asked to remove `svsnkr496@gmail.com` and its test gym "Chaos combat": deleted (05 Nov 2026).
- Demo login created for pitching: `admin@xelorsoft.com` (password shared with the owner directly, not stored in the repo),
  owner of "XS Fitness Studio" seeded with `scripts/demo/seed_rich_demo.sql`; subscription active for a year.
- Client auth switched to implicit flow so dashboard-sent recovery and confirmation emails work on any device.
- Dashboard rebuilt iOS-style: greeting, round quick actions (pills on wide screens), "Collected today" hero
  with cash/UPI bar, 2×2 stat tiles, inset grouped "This month" and "Latest check-ins" lists (`dashboard.css`).
  Dark mode now uses iOS system greys (#000 / #1C1C1E / #2C2C2E); no white focus box on mouse click; thin
  scrollbar on laptops; full sidebar from 1000 px. UI suite adds iPhone 16 Pro Max (440) and iPad Pro 13 (1032),
  with `SIZES=` and `SCHEME=dark` filters.
- Appearance switch (Auto / Light / Dark): sidebar button cycles it, phone "More" sheet and Settings have a
  segmented control. Saved per browser (`xs-theme`), applied before first paint by `public/theme.js`; CSS keys
  dark mode off `<html data-theme>` instead of the media query. UI check covers switching and reload.
- Elevation system (`src/styles/elevation.css`): layered shadow tokens `--elev-1/2/3`, hero, button and chip
  levels. Dark mode uses top highlights, faint rings and a subtle sheen instead of invisible shadows. Tappable
  cards lift 2 px on hover (pointer devices only, off with reduced motion); flat in high contrast and print.
- Status colours: iOS hues (red, green, orange) — vivid for dots/icons, text shades kept at ≥ 4.5:1 on white and
  on their tints; dark mode uses iOS dark system colours. Shown only on status (badges, dues, expiring icon).
- Inputs: filled 48 px fields, 12 px radius, hairline edge; hover darkens the fill (90 ms), focus lifts to white with
  a crisp ring and soft halo; custom select chevron; red ring when invalid. All hover/press transitions 80–140 ms;
  card hover shadow fades on a pre-rendered layer (compositor-only, no repaint).
- Vendor code split into `react`, `supabase` and `vendor` chunks so releases don't re-download libraries.
- `tests/ui/perf.mjs` (shared fixtures in `tests/ui/mock.mjs`): 4× CPU + fast 4G phone profile. Latest:
  LCP 1.3–1.5 s, CLS ≤ 0.035, TBT ≤ 234 ms, worst tap-to-paint 72 ms; hover, theme switch, typing and scroll
  all hold 60 fps (p95 16.7–16.8 ms, no frames over 33 ms). First-load JS still ~193 KB gzip (budget 170).
- End-to-end suite (`tests/e2e/`): phone, tablet, laptop × 39 real-user steps on a local copy of the backend
  (live schema verified identical). 117/117 pass. Found and fixed: sheets hidden under the phone tab bar
  (Save unreachable), fast double-tap ran a payment/sale success twice, import preview marked existing
  members' phones as Ready, plan Unit switch mislabelled for screen readers.
- Open decision: voiding a paid membership charge turns the payment into credit but leaves the membership active.
- Section switching made instant: page code preloads on idle, each section's first query is shared
  (`src/lib/sections.ts`) and prefetched on idle and on hover/touch; tab/sidebar switches no longer run a view
  transition (push/pop still do). Tap-to-content 13–40 ms in page; 110–180 ms end to end with CDN/API delays
  (was 290–370 ms on first visit). `tests/ui/switching.mjs` guards it. Cancelled phone transitions are silenced.
- XS AI (docs/XS_AI.md): voice + text assistant, English and Malayalam, full control without confirmation
  (owner's choice) but with Undo cards, ≤ 6 changes/request, role-filtered tools, user-token-only data access.
  Edge Function `xs-ai` deployed (v1). OWNER ACTION: add secret LLM_API_KEY (free Gemini key) in Supabase.

### 2026-11-05 — Session 1

- Phase 0: inspected supplied files (greenfield), recovered SVG masters, wrote audit, plan, design docs and ADRs.
