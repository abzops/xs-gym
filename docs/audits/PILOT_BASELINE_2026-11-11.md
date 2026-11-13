# XS Gym — Pilot Production Baseline

**Date:** 2026-11-11 (IST)  
**Scope:** GitHub/Supabase **read-only** production inspection; no production writes  
**Production ref:** `abzops/xs-gym@9b8da8bf6ea0d330277ba5a83f94b92100427850`  
**Audit development branch:** `feature/pilot-safety-audit`  
**Customer:** CHAOS COMBAT — cooperative pilot; real data protected

This report uses the categories **VERIFIED**, **INFERRED** and **REQUIRES MANUAL CHECK**. It does not assume prior counts, backups or successful test reports constitute current production proof.

## Production baseline

| Component | Evidence and result | Classification |
|---|---|---|
| Supabase | Project `xs-gym` in `ap-south-1`, `ACTIVE_HEALTHY`, PostgreSQL 17.11; read-only Management API `get_project` | VERIFIED (project metadata) |
| Frontend deployment | `main` commit `9b8da8b`; [Test and deploy run 43024755329](https://github.com/abzops/xs-gym/actions/runs/43024755329) and [Pages run 43024821272](https://github.com/abzops/xs-gym/actions/runs/43024821272) concluded success; `gh-pages` was published from this release | VERIFIED (CI metadata); direct live-browser user journey REQUIRES MANUAL CHECK |
| Production branch | `main` is **not protected**; no open PRs at audit start | VERIFIED (GitHub API) |
| Deployment trigger | [pages.yml](https://github.com/abzops/xs-gym/blob/main/.github/workflows/pages.yml) publishes on pushes to `main` and listed legacy feature branches build/test; the deploy job is restricted to `main` | VERIFIED (source) |
| Database schema | 17 public tables; 17 have row-level security enabled | VERIFIED (Supabase schema metadata) |
| Migration ledger | 7 applied: foundation, operations, commands, analytics/leads/onboarding, payment corrections, permanent member deletion, editable joining date | VERIFIED (Supabase migration metadata) |
| XS AI Edge Function | `xs-ai` active at version 19, JWT verification enabled | VERIFIED (Supabase function metadata); model/provider efficacy REQUIRES MANUAL CHECK |
| Database advisors | Security: 24 authenticated `SECURITY DEFINER` execution warnings; 1 leaked-password-protection warning. Performance: 13 unindexed-FK infos, 2 unused-index infos. Health: no findings | VERIFIED (Supabase advisor); warnings are *not* confirmed exploits |
| Privileged RPC inventory | 24 `public` SECURITY DEFINER function overloads; all report `search_path=''`, no anonymous EXECUTE, authenticated EXECUTE allowed | VERIFIED (pg_catalog metadata); individual authorization logic still needs isolated adversarial testing |
| Pilot roster | CHAOS COMBAT: **26 active** member records, **0 archived**, **0 payments**, **0 memberships** at read-only audit | VERIFIED (aggregates only). Exact per-row source reconciliation REQUIRES OWNER APPROVAL |
| Tenant footprint | Three gyms present in the shared backend. No observed orphan members or memberships in integrity summary | VERIFIED (aggregate checks); classification of other tenants as demo/real REQUIRES MANUAL CHECK |
| Private snapshots | `private.member_roster_backups` table exists but currently contains **zero snapshot records**; no recorded `admin.roster_purge` event was found. Previous chat reported snapshots, which cannot currently be recovered from this project | VERIFIED (metadata queries); why previous records are unavailable REQUIRES MANUAL CHECK |
| Managed backups | Supabase [backup documentation](https://supabase.com/docs/guides/platform/backups) says Pro/Team/Enterprise have scheduled daily backups; Free requires user-managed export. Current subscription tier and dashboard backup schedule not exposed by project metadata | REQUIRES MANUAL CHECK |
| Authentication | [AuthPages.tsx](https://github.com/abzops/xs-gym/blob/main/src/features/auth/AuthPages.tsx) implements password login/signup/reset; Supabase console redirect/SMTP/leaked-password settings weren't accessible read-only | VERIFIED (code) / REQUIRES MANUAL CHECK (live config) |
| Member import | [ImportPage.tsx](https://github.com/abzops/xs-gym/blob/main/src/features/members/ImportPage.tsx) previews CSV, flags malformed/duplicate rows, then calls `create_member` per row | VERIFIED (code); repeat-safe batch handling is not demonstrated |
| Automated tests | [E2E run 43024755469](https://github.com/abzops/xs-gym/actions/runs/43024755469) passed 43/43 on each of phone, tablet, laptop; CI operates on disposable PostgreSQL / synthetic fixtures, not real iPhone hardware | VERIFIED (CI); real-world pilot UAT REQUIRES MANUAL CHECK |
| Source-of-truth documents | [PROGRESS.md](https://github.com/abzops/xs-gym/blob/main/PROGRESS.md) still says 4 migrations and reflects the older 06 Nov state; [OWNER_DECISIONS.md](https://github.com/abzops/xs-gym/blob/main/docs/OWNER_DECISIONS.md) contains assumed, undecided rules | VERIFIED (repository); outdated lines are historical, not authoritative current counts |

## Top five risks (ordered by impact)

1. **CRITICAL — Unverified recoverable backup.** Zero private snapshots observed and no demonstrated restore drill. Halt destructive production changes. Verify plan/backups without exporting data to chat; obtain an encrypted off-site solution and staging-only restoration evidence.
2. **HIGH — Accidental release to the pilot.** `main` is unprotected; a push automatically publishes. Protect `main`, require PR approval, checks and the exact owner-approved release window. None of these settings were changed by this audit.
3. **HIGH — Ledger and membership semantics remain undecided.** Voiding a paid charge releases its payment into credit while membership access remains active. Do not silently choose cancellation versus retention; document current result and request an owner decision before modifying logic.
4. **HIGH — Privileged RPC surface needs adversarial review.** 24 callable SECURITY DEFINER overloads have fixed `search_path` and no anon execution, but that alone does not prove correct per-gym authorization or concurrency safety. Run synthetic multi-role/multi-tenant tests and review each operation's guards.
5. **HIGH — Pilot import/reconciliation and delete hazards.** In-app CSV import has client-side preview but no durable batch ID, explicit retry ledger or verified read-only reconciliation. A failed existing-member lookup may leave all rows appearing ready. Permanent delete is irreversible for profiles without protected history; owner policy and UI safeguards require review.

## Additional findings and qualifications

- Frontend deployment **success** is not a browser availability test; a direct independent live-app load was unavailable during this audit.
- No production authentication emails, credential resets or paid subscriptions were exercised.
- PostgreSQL in production reports major version 17; synthetic CI database runs PostgreSQL 16, which is useful but not a perfect production-version match.
- 13 unindexed foreign keys and 2 unused index notices are performance candidates, not authorization defects. Review query plans before proposing indexes or dropping any index.
- The claimed previous backup/purge activity needs a separate chain-of-custody review. Do not infer recovery is possible from the existence of a backup table.

## Proposed safe change sequence (no production action)

1. Create a dedicated isolated GitHub Actions workflow for feature branches. Use local PostgreSQL 16, the Supabase shim, synthetic Test Gym A and B, synthetic payments and Playwright. No production URL or token in the workflow; no deployment job.
2. Add synthetic payment tests and document the paid-charge-void result; no change to the business rule.
3. Publish `PAYMENT_LEDGER_REVIEW.md`, `SECURITY_AND_TENANCY_REVIEW.md`, `BACKUP_RESTORE_RUNBOOK.md` and `MEMBER_IMPORT_RECONCILIATION.md` for owner review.
4. Seek owner decisions for paid-charge void, permanent deletion and RPO/RTO. Separately verify Supabase's actual plan/backup settings.
5. Propose small code changes in fresh `feature/*` branches; PR only. **Do not merge or deploy without `APPROVE DEPLOY`.**

## Safety statement

**Production changes made: NONE. Pilot member data touched: NO.** All SQL executed for this inspection was read-only and restricted to aggregate counts or schema/security metadata. No customer data has been exported or committed to this repository.

**Release recommendation: HOLD.**
