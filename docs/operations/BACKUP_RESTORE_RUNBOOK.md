# XS Gym — Backup and Restore Runbook (pilot protection)

**Prepared:** 2026-11-11 | **Current status:** DESIGN / synthetic drill pending CI confirmation  
**Live customer backup configured:** NOT VERIFIED | **Production export performed:** NO

## 0. Non-negotiable controls

- Never run a backup-restoration test on the production Supabase project.
- Never copy CHAOS COMBAT member names, phones, registrations, medical data, financial rows, database dumps, JWTs or keys into GitHub, CI artifacts, chat or public object storage.
- A private SQL table containing JSON is **not** evidence of a functioning backup strategy. The read-only audit observed zero rows in the private roster snapshot table.
- All production backup schedules, paid-plan changes, secret provisioning, data exports and restore operations require an approved owner action and a privacy/security review.

## 1. Options (confirm actual plan first)

**Option A — Managed Supabase backups**: The [Supabase backups documentation](https://supabase.com/docs/guides/platform/backups) currently states daily backups for Pro, Team and Enterprise, with the Pro plan retaining 7 days. Point-in-time recovery is a separate add-on. Check the production project's actual plan, dashboard `Database > Backups` schedule and recoverability. Do not assume a backup is present because the database is healthy.

**Option B — Self-managed encrypted backups**: For Free tier, documentation recommends regularly exporting data with the CLI. Set up a least-privilege automated backup process; encrypt immediately before transfer; store off-site in a private versioned bucket with restricted access, object lock where available, access audit and alerting. Review whether authentication data, storage objects, privileged functions, roles, policies and custom schemas are included; database-only dumps do not automatically back up every external file or configuration setting.

Neither option has yet been approved or enabled by this session.

## 2. Proposed service levels — for owner approval

| Decision | Proposed pilot starting point | Final |
|---|---|---|
| Recovery point objective (RPO) | ≤24 hours until budget permits shorter recovery | OWNER PENDING |
| Recovery time objective (RTO) | ≤8 hours for a verified small pilot database | OWNER PENDING |
| Daily retention | At least 7 days of recoverable versions | OWNER PENDING |
| Longer retention | Weekly for 4 weeks and monthly for 3 months, if privacy policy allows | OWNER PENDING |
| Escalation | Named XS Gym technical owner + CHAOS COMBAT contact | OWNER PENDING |
| Recovery authority | Two-person approval, restore into isolated target first | OWNER PENDING |

These are proposals, **not** service guarantees.

## 3. Backup creation (future approved production workflow)

1. Owner reviews production plan and current recovery features in Supabase Dashboard.
2. Record backup request ID, UTC time, source project, scope and expected consistency point.
3. Use the protected service account/secret manager, never browser code or personal chat.
4. Export transactional database/schema/roles and any required Auth/Storage content using supported, version-matched tooling. Determine documented exclusions before relying on the backup.
5. Immediately encrypt the backup using an approved key manager. Use TLS during upload.
6. Store encrypted bytes in an access-controlled off-site store, not the Git repository, CI artifacts, public Supabase Storage or a shared drive.
7. Verify size, checksum, completed upload, restoration metadata, retention policy and monitoring alert.
8. Keep an audit record without including customer identifiers/rows in logs.

## 4. Synthetic restoration drill (implemented on feature branch)

`tests/db/pilot_restore_drill.sh`:
- Refuses `DATABASE_URL`, `PGHOST`, `PGPASSWORD` or a Supabase access token.
- Starts throwaway local PostgreSQL 16 with a Unix socket, no externally listening address.
- Loads the repository's Supabase shim and all migration files.
- Runs `tests/db/test_core.sql` to seed/test **two fake gym tenants** and synthetic payments.
- Executes local `pg_dump`, restores into a second local database and compares aggregate row counts, integer-paíse totals, RLS-enabled table count and anonymous payment EXECUTE privilege.
- Deletes the temporary database and dump on exit, leaving no stored artifact.
- **Does not test** live customer backup recoverability, PITR, Auth service configuration or remote file storage.

**Drill evidence:** To be populated from the isolated CI workflow in the feature PR after completion. A local drill cannot be called production recovery readiness.

## 5. Approved live recovery (requires separate authorization)

1. Declare incident; stop writes if data-integrity loss is ongoing.
2. Notify owner and pilot; document time, affected tenant and target recovery point.
3. Verify most recent usable encrypted/managed backup and credentials without exposing bytes.
4. Create isolated restoration target (separate project/cluster) with production network access disabled.
5. Restore encrypted backup to target and validate schema, roles, tenant scoping, authentication behavior, subscriptions, member totals, payment+allocation invariants and accounting balances. Run privacy-secured checks; do not reproduce real data in reports.
6. Compare proposed restoration cutover delta and explain losses in the RPO window; obtain explicit owner approval for any irreversible switch.
7. Only after all gates pass, schedule a production maintenance/cutover and communicate to the customer.
8. Run post-restore smoke checks under least privilege, record incident and retain the original for forensic review.

## 6. Operational checklist

- [ ] Supabase production plan and restore entitlement independently verified in Dashboard
- [ ] Backup destination and encryption keys approved
- [ ] Scheduled backups enabled, monitored, retention enabled
- [ ] Synthetic isolated restore passed in CI
- [ ] Restoring a real production backup into an approved protected staging environment passed (requires owner approval; **not done**)
- [ ] RPO/RTO and owner escalation contacts signed off
- [ ] Any live data-affecting release includes a fresh, confirmed restorable backup

**Status: production backup/restore readiness BLOCKED until owner-approved recovery evidence exists.**
