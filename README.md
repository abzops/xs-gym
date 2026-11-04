# XS Gym

Gym management SaaS by Xelorsoft: members, memberships, attendance, payments,
expenses, reports and an AI voice assistant, as an installable web app for phone,
tablet and laptop. Backend: Supabase. Hosting: GitHub Pages.

**Status:** P0 core operations live for the pilot — <https://abzops.github.io/xs-gym/>.
See [`PROGRESS.md`](PROGRESS.md) for what works, what is pending and owner actions.

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
src/        React app (features/, app/, components/, lib/, styles/)
supabase/   database migrations (tables, RLS, command and report functions)
tests/      db/ (PostgreSQL tests), ui/ (responsive screen checks)
public/     icons, logo variants, web manifest
brand/      official Xelorsoft assets (source/ unchanged, derived/ recovered SVGs)
docs/       specification, plans, design docs, decision records
.github/    CI: tests, build, publish to gh-pages
```

## Run locally

```bash
cp .env.example .env.local      # fill in the Supabase URL and publishable key
npm ci
npm run dev                     # http://localhost:5173
npm test                        # unit tests
PG_RUN_AS=$USER bash tests/db/run.sh   # database tests (needs PostgreSQL 16)
npm run build                   # production build in dist/
```

## Rules

Never commit secrets, `.env` files, database dumps or real member data. Small
commits, one change each; update `PROGRESS.md` with the work it describes.
