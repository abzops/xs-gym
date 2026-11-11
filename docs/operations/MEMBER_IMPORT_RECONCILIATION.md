# XS Gym — Member Import and Pilot Reconciliation Protocol

**Status:** design and code review only; no production member records edited  
**Source:** [ImportPage.tsx](https://github.com/abzops/xs-gym/blob/main/src/features/members/ImportPage.tsx) and [csvParse.ts](https://github.com/abzops/xs-gym/blob/main/src/lib/csvParse.ts)

## Findings

Current CSV import supports a preview, per-row name/phone/date/email validation, in-file duplicate phone detection, basic matching to existing member phone numbers, per-row RPC create, and an added/rejected summary. It is **not yet a durable import-batch workflow**.

Risk and constraints:
- The existing-member lookup does not handle a Supabase query error explicitly. On failure, the displayed preview may incorrectly mark all rows as ready.
- Duplicate matching uses only a normalized phone suffix; ambiguous archived duplicates and owner-edited numbers require manual resolution.
- No server-side import-batch key, source row hash or resume checkpoint exists; a browser reload mid-import loses the client-side result list.
- `create_member` guards duplicate active phone numbers at the database, which helps prevent duplication, but repeated imports have no single stable idempotency key for the complete source batch.
- Client processes up to 2,000 rows; only first 200 preview rows are displayed. Results are per record; no immutable import summary is stored.
- The import UI must not silently overwrite/archive/delete member or financial records.

## Proposed design (P1)

1. **Upload/preview only**: decode CSV locally, enforce size/row limits, canonicalise India phone numbers, normalize dates with DD/MM/YYYY and ISO support. Do not transmit source members until confirmation.
2. **Dry-run button**: validation and comparison only. If existing-member lookup fails, block import and show a retriable error; never assume all contacts are new.
3. **Preview all exceptions**: missing names, malformed phones, duplicate source phones, existing active/archived matches, invalid dates, conflicts in membership dates and reason.
4. **Explicit member mapping**: for each potential match, allow **skip**, **create separately** (only when safe), or **manual review**. No silent overwrites. Keep existing member ID and join-date changes protected.
5. **Stable `import_batch_id`**: derive or assign a UUID and source fingerprint. The server records each row's stable identity, decision, result and commit time; repeated same batch + row is idempotent.
6. **Atomicity options**: prefer an owner-selected atomic full batch when all rows are valid; for partial batches, show complete failure and retry lists. Never delete prior members as an automatic step in an import.
7. **Reconciliation report design** (no pilot query yet): `uploaded_rows = validated + rejected`, `ready = inserted + skipped_duplicate + failed`, source fingerprint, batch ID, inserted count, current member count, last matching timestamp, missing rows and unexpected records.
8. **Privileged backend**: add dedicated insert-only RPC or batch table with RLS and gym ownership guard; don't permit direct unguarded writes to members. SQL must use parameterized values.
9. **Privacy**: no real names, phone numbers, form images or email addresses in source control, logs, screenshots or CI. Only synthetic fixtures.
10. **Owner sign-off**: require explicit approval before any read-only record-by-record reconciliation against CHAOS COMBAT; aggregate-only monitoring is permitted by the present audit scope.

## Current pilot (read-only aggregate baseline)

On 2026-11-11 CHAOS COMBAT had **26 active members and zero archived members**. The source file is not re-read or matched row-by-row in this audit; therefore the upload's 26 successes and the source's exact 26 identities are **not yet independently reconciled**. Do not re-import the spreadsheet or reset the gym to "fix" an assumed mismatch.

## Synthetic acceptance matrix (to implement in the next PR)

| Test case | Expected |
|---|---|
| Empty input or missing name/phone headers | Reject, no writes |
| Mixed CRLF/quoted names, Unicode, leading +91 | Parse exactly, normalize safely |
| Same source phone on two lines | Conflict reported with both row references |
| Existing active phone | Mark possible duplicate, no auto-overwrite |
| Existing archived phone | Manual review, no silent reactivation |
| Existing-member lookup error | Block import; report error and retry |
| Repeat same batch after refresh/network retry | No duplicate inserts |
| Partial timeout or server 503 | Persist per-row results, safe resume |
| Wrong gym ID or staff permissions | Zero cross-tenant inserts |
| Duplicate names with distinct phones | Allowed if intentionally separate |
| Expected row count differs from inserted count | Report exception; do not auto-delete |
| New joining date then member edit | Preserves membership period and audit trail |

**Release recommendation:** HOLD until dry-run/idempotency/exception handling are implemented and validated on synthetic data.
