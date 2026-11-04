# XS Gym — Deployment

## 1. Environments

| Env | Frontend | Backend | Data |
|---|---|---|---|
| Local | `npm run dev` | Supabase local stack (owner's machine or CI) | Synthetic seed |
| Staging | GitHub Pages preview path or second Pages site | Supabase `xs-gym-staging` | Synthetic + UAT |
| Production | GitHub Pages → `gym.xelorsoft.com` | Supabase `xs-gym-prod` | Real tenant data |

## 2. GitHub Pages (D-01)

**One-time setup by the owner**
1. Make `abzops/xs-gym` public (required on GitHub Free) — or use a paid plan.
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Give the Claude GitHub App access to the repo (see `PROGRESS.md` X1).

**Workflow** `.github/workflows/pages.yml` deploys on every push to `main`:
- Phase 0–2: publishes `site/` (a project status page; no app yet).
- Phase 3 onward: runs `npm ci && npm run build`, then publishes `dist/`. The
  deploy job runs only after lint, typecheck, tests and the secret scan pass.

**Base path.** Until the custom domain is live the site is served at
`https://abzops.github.io/xs-gym/`, so the build uses `VITE_BASE_PATH=/xs-gym/`.
After DNS cut-over it becomes `/`.

**Deep links.** Pages has no rewrites. The build copies `index.html` to
`404.html`, so `/g/<gym>/members/123` loads the app (HTTP status 404 is harmless
for a signed-in app that is not indexed). The PWA service worker handles
navigation once installed.

**Security headers** are not possible on Pages; see `SECURITY.md` §7.

## 3. Custom domain (Phase 10, D-14)

1. DNS: `CNAME gym → abzops.github.io`.
2. Verify the domain for the `abzops` account in GitHub settings (TXT record) to
   prevent takeover.
3. Repo → Pages → Custom domain `gym.xelorsoft.com` → Enforce HTTPS.
4. Update Supabase Auth Site URL and redirect URLs; rebuild with `VITE_BASE_PATH=/`.

## 4. Supabase

Migrations applied by CI with the Supabase CLI (`supabase db push`) using
`SUPABASE_ACCESS_TOKEN` and the project ref from Actions secrets — staging on
merge to `main`, production only on a tagged release after approval. Edge
Functions deployed the same way. Auth redirect URLs: Pages URL(s) and
`http://localhost:5173` for staging only.

## 5. Backups (D-09)

Before production data exists: Supabase Pro daily backups, or a nightly Actions job
running `pg_dump` → encrypted with `age` → private off-site storage; Storage
objects backed up separately. Restore drill into staging before go-live and
monthly after. Full runbook: `BACKUP_RESTORE.md` (Phase 9).

## 6. Release and rollback

Release = tag `vX.Y.Z` on `main` + `CHANGELOG.md` entry + release report (tests,
known limitations, backup evidence). Frontend rollback: re-run the Pages workflow
on the previous tag. Database: forward-fix migrations; destructive migrations need
a tested down-path and a fresh backup first.
