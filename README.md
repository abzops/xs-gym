# XS Gym

Gym management SaaS by Xelorsoft: members, memberships, attendance, payments,
expenses, reports and an AI voice assistant, as an installable web app for phone,
tablet and laptop. Backend: Supabase. Hosting: GitHub Pages.

**Status:** Phase 0 (discovery and plan) — no application code yet.
Live status page: https://abzops.github.io/xs-gym/ (once Pages is enabled).

## Start here

| Read | For |
|---|---|
| [`PROGRESS.md`](PROGRESS.md) | Where the work stands, blockers, next step — **read first when resuming** |
| [`docs/source/XS_Gym_End_to_End_Engineering_Blueprint.md`](docs/source/XS_Gym_End_to_End_Engineering_Blueprint.md) | The specification |
| [`docs/PROJECT_AUDIT.md`](docs/PROJECT_AUDIT.md) | Phase 0 findings |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Phases, gates, dependencies, costs |
| [`docs/OWNER_DECISIONS.md`](docs/OWNER_DECISIONS.md) | Decisions needed from the owner |

Design: [`ARCHITECTURE`](docs/ARCHITECTURE.md) · [`DATABASE`](docs/DATABASE.md) ·
[`SECURITY`](docs/SECURITY.md) · [`AI_AND_VOICE`](docs/AI_AND_VOICE.md) ·
[`TEST_PLAN`](docs/TEST_PLAN.md) · [`DEPLOYMENT`](docs/DEPLOYMENT.md) ·
[`PRODUCT_REQUIREMENTS`](docs/PRODUCT_REQUIREMENTS.md) · [ADRs](docs/DECISIONS/)

## Repository layout

```text
brand/      official Xelorsoft assets (source/ unchanged, derived/ recovered SVGs)
docs/       specification, plans, design docs, decision records
site/       Phase 0 status page published to GitHub Pages
.github/    CI and Pages deployment
```

`src/`, `supabase/` and `tests/` arrive in Phase 3.

## Rules

Never commit secrets, `.env` files, database dumps or real member data. Small
commits, one change each; update `PROGRESS.md` with the work it describes.
