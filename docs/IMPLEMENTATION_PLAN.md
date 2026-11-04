# XS Gym — Implementation Plan

Derived from the blueprint (§13, §17). Each phase ends at an exit gate; no phase
starts until the previous gate passes. Status is tracked in `PROGRESS.md`.

## 1. Phase map

| Phase | Goal | Key deliverables | Exit gate | Owner input |
|---|---|---|---|---|
| **0** Discovery | Know what exists | `PROJECT_AUDIT.md`, this plan, design docs, ADRs | Owner reviews audit + plan | Review |
| **1** Requirements & UX | Confirm real workflows | Interview notes, top-10 daily tasks, user stories + acceptance criteria, responsive wireframes, click-through prototype | Owner signs off P0 workflows | D-02, D-12 |
| **2** Architecture & threat model | Lock schema and security | ERD, migration plan, RLS policy matrix, entitlement model, AI/voice privacy boundary, backup approach | Architecture + security review approved | D-03…D-08 |
| **3** Foundation | Signed-in tenant shell | Vite + React + TS, lint/format/typecheck/test scripts, design tokens, responsive shell, auth, tenant resolution, first migrations + RLS, CI, Pages deploy, error boundary | User signs in and sees only their gym's shell; CI green | D-05, D-10, D-13, X1, X4 |
| **4** Core operations | Daily gym work | In order: members → plans & memberships → attendance → payments & receipts → expenses → dashboard & reports. Each with UI, validation, RPC, RLS, audit, tests, docs | P0 workflows pass integration + E2E | UAT data |
| **5** Mobile/tablet & PWA | Fits every device | Viewport matrix fixes, manifest + icons (incl. maskable), app-shell cache, offline indicator, a11y + performance budget | No critical responsive defects; no unsafe offline writes | — |
| **6** AI text assistant | Ask and act safely | Edge Function gateway, provider adapters, quotas, typed tools, confirm-then-execute UI, prompt-injection tests | AI answers approved queries and executes permitted actions only after confirmation | AI provider accounts |
| **7** Voice | Speak to the app | Push-to-talk UI, STT/TTS proof of concept, Malayalam/English/Manglish test set, cancel/interrupt, usage meter | Works on target devices; text fallback always available | Voice provider choice |
| **8** SaaS subscription | Trial and plans | Trial activation, 30-day server-side expiry, entitlements, upgrade page, manual verified payment, reminders, expired-state export | Trial cannot be reset by any client action | Pricing |
| **9** QA, security, UAT | Prove it | Full regression, cross-tenant tests, money + date boundary tests, voice action tests, backup/restore drill | No open critical/high issues; owner signs off | UAT |
| **10** Production | Go live | DNS + custom domain, production Supabase, secrets, migrations, SSL, smoke tests, rollback plan | Release checklist signed | D-09, D-14 |
| **11** Operate | Improve | Weekly feedback, error/latency/quota review, backup verification | Ongoing | — |

## 2. Working method

- **Vertical slices.** A feature is done only per the blueprint's Definition of Done (§14.5).
- **One pattern for writes.** Reads go through RLS; every mutation goes through a
  database command function that authorises, validates, writes and audits in one
  transaction (ADR-0002). AI tools call the same functions.
- **Small commits**, pushed often; `PROGRESS.md` updated in the same commit.
- **Synthetic data only** until UAT approval; seed data is clearly marked.

## 3. Phase 3 bootstrap commands (for reference; run in Phase 3, not now)

```bash
npm create vite@latest . -- --template react-ts
npm install @supabase/supabase-js @tanstack/react-query react-router react-hook-form zod @hookform/resolvers date-fns lucide-react @fontsource/manrope @fontsource/ibm-plex-mono
npm install -D vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @playwright/test @axe-core/playwright prettier eslint pg @types/pg
```

Install only what the current phase needs. Charts (`recharts`), PWA
(`vite-plugin-pwa`), toasts (`sonner`) and Tailwind are added in the phase that
first uses them, after compatibility checks.

## 4. Dependency plan

Latest versions on npm, checked 05 Nov 2026. Pin exact versions via the lockfile at
install time. **Several are new majors** (TypeScript 7, React Router 8, Vite 8,
Vitest 5, Zod 4, Tailwind 4): confirm the toolchain supports each together before
adopting; if not, pin the newest compatible version and record it in an ADR.

| Package | Latest | Phase | Why |
|---|---|---|---|
| react, react-dom | 19.3.1 | 3 | UI |
| vite, @vitejs/plugin-react | 8.3.5 / 6.2.1 | 3 | Build and dev server |
| typescript | 7.0.2 | 3 | Strict typing |
| @supabase/supabase-js | 2.119.0 | 3 | Auth, data, storage client |
| react-router | 8.5.1 | 3 | Routes (base path configurable for Pages) |
| @tanstack/react-query | 5.105.3 | 3 | Server-state cache |
| react-hook-form, zod, @hookform/resolvers | 7.91.0 / 4.6.7 / 7.0.2 | 3 | Forms + runtime validation |
| date-fns | 4.4.0 | 4 | Date display only; business dates computed in DB |
| lucide-react | 1.68.0 | 3 | Icons |
| @fontsource/manrope, @fontsource/ibm-plex-mono | 5.3.0 | 3 | Self-hosted brand fonts (OFL) |
| vitest, @testing-library/react | 5.1.0 / 16.3.3 | 3 | Unit + component tests |
| @playwright/test, @axe-core/playwright | 1.64.1 / 4.14.0 | 3 | E2E, responsive, a11y |
| pg | — | 3 | DB tests switching roles/JWT claims |
| vite-plugin-pwa | 2.0.0 | 5 | Manifest, service worker |
| recharts | — | 4 (reports) | Charts, lazy-loaded |
| supabase (CLI) | 3.0.0 | 3 (CI) | Migrations, local stack in CI |

## 5. Environment variables (names only)

Frontend (public, safe in the bundle): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_APP_URL`, `VITE_BASE_PATH`.

Server-side only (Edge Function / GitHub Actions secrets, never `VITE_`):
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (CI migrations and backups),
`SUPABASE_ACCESS_TOKEN` (CLI deploys), and from Phase 6+: `GEMINI_API_KEY`,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `AI_DEFAULT_PROVIDER`,
`AI_FALLBACK_PROVIDERS`, `VOICE_STT_PROVIDER`, `VOICE_TTS_PROVIDER`,
`VOICE_PROVIDER_API_KEY`; Phase 8 if a gateway is used: `PAYMENT_PROVIDER_SECRET`,
`PAYMENT_WEBHOOK_SECRET`. Only define a provider's secret once it is selected.

## 6. External accounts

| Account | Needed by | Who creates | Cost |
|---|---|---|---|
| GitHub repo `abzops/xs-gym` + Claude GitHub App access | Now | Owner | Free (public repo) |
| GitHub Pages (Source: GitHub Actions) | Phase 3 | Owner enables in repo settings | Free |
| Supabase staging + production projects | Phase 3 | Owner (D-13) | Free to start; Pro from $25/month (D-09) |
| DNS for `xelorsoft.com` | Phase 10 | Owner (D-14) | Existing |
| Google AI Studio (Gemini), Groq, OpenRouter keys | Phase 6 | Owner | Free tiers, quotas vary — verify then |
| Speech provider (STT/TTS) | Phase 7 | Owner, after PoC | Likely paid per minute |
| Email provider | P1 | Owner | Free tiers exist |
| WhatsApp Business Platform | P1 | Owner, after business verification | Per-conversation pricing |
| Payment gateway | Phase 8 (optional) | Owner | Per-transaction fees |

## 7. Free-tier limits and likely costs

Verified 05 Nov 2026 from supabase.com/pricing and GitHub docs. Re-check before launch.

| Service | Free limit / constraint | When it matters |
|---|---|---|
| Supabase Free | 500 MB database, 1 GB storage, 5 GB egress, 50,000 MAU, 500,000 Edge Function calls, 2 active projects, **pauses after 1 week inactive**, **no backups** | Production readiness (D-09) |
| Supabase Pro | From $25/month; daily backups kept 7 days; PITR extra ($100/month per 7 days) | Go-live |
| Supabase custom API domain | $10/month per project | Not needed |
| GitHub Pages | Public repos only on Free; no custom HTTP headers | Now (D-01) |
| AI / voice providers | Quotas and data-use terms change; free ≠ unlimited | Phases 6–7 |

## 8. Test environments

| Where | What runs | Authority |
|---|---|---|
| This workspace | Unit/component tests; migrations, RLS and money/date tests on real PostgreSQL 16 with an `auth` stand-in; Playwright against the frontend with a mocked API | Fast feedback only |
| GitHub Actions | Same, plus the real Supabase local stack (`supabase start`) for RLS, RPC and full-stack E2E | **Authoritative gate** |
| Staging project | UAT, manual device testing | Pre-release |

See `TEST_PLAN.md` and ADR-0006.

## 9. Design documents

`PRODUCT_REQUIREMENTS.md` · `ARCHITECTURE.md` · `DATABASE.md` · `SECURITY.md` ·
`AI_AND_VOICE.md` · `TEST_PLAN.md` · `DEPLOYMENT.md` · `OWNER_DECISIONS.md` ·
`DECISIONS/` (ADRs).
