# XS Gym — Member import validation, isolated feature PR

**Date:** 11 Nov 2026 | **Branch:** `feature/member-import-validation`  
**Production impact:** NONE. Not deployed. No live CSV uploaded, records imported or identities inspected.

## Scope implemented (browser UI + pure client validation; current backend unchanged)

- A CSV file is parsed locally for a **dry-run preview**, without calling `create_member`.
- Invalid/unclosed quoted fields, malformed phone formats (including wrong country code or excessive digits), impossible dates, source duplicate phones, missing headers and files over 2 MB are rejected or displayed as conflicts.
- No more than **2,000 source rows**; beyond this import is blocked, not silently truncated.
- A paginated, read-only existing-member lookup includes **active and archived** member records. All phone matches are marked for explicit manual resolution, never auto-restored or overwritten.
- If member lookup fails or cannot be completed, the preview is blocked (**fail closed**); a fresh upload is required.
- Valid preview requires explicit operator confirmation. `create_member` is not called on file selection or preview.
- Just before the first write, the app performs a second read-only lookup and revalidates the preview. Any intervening member status/phone conflict blocks submission and asks for a fresh confirmation.
- A synchronous in-flight guard blocks accidental double-taps. After confirmation, each accepted row uses existing permission-checked `create_member` RPC; per-row success/failure result is shown.
- The existing server blocks duplicate **active** phone numbers. UI prevents knowingly creating a duplicate of archived members.
- No delete/archive/update is invoked by the import UI. No silent modification of customer records.

## Synthetic tests

- `src/lib/memberImport.test.ts`: archived and active phone match, source immutability, changed-snapshot detection and invalid-row preservation.
- `src/lib/csvParse.test.ts`: Indian mobile formats, invalid phone lengths/country codes, duplicate number formats, invalid CSV quoting.
- `tests/e2e/e2e.py`: dry-run creates no data; Add disabled until confirmation; repeat upload doesn't duplicate; simulated lookup HTTP failure shows error and never starts a write.
- Isolated Action `Member import isolated validation`: static, unit, local two-tenant DB and phone/tablet/laptop tests, without production URL or deployment job.

## Explicit limitations — separate future work

1. **No server-side durable import batch ID yet.** A restart after partial success must rerun a fresh preview; auto-resume is intentionally not implemented. A future migration/RPC needs isolated review and approval before it can be deployed.
2. **Time-of-check/time-of-use interval:** another staff member might modify archived status after the last preview check; active-phone insert uniqueness still protects current active duplicates, but a fully atomic server import would provide stronger guarantees.
3. A CSV with phone numbers not in accepted Indian formats is blocked. Multi-country phone numbering is a future explicit requirements decision.
4. The server still accepts per-row `create_member`; the preview is not an authoritative write-time batch transaction.
5. The preview reads existing member contact fields within the current signed-in gym permissions only; ensure privacy-safe screenshots and no customer-data logging.
6. The current data set's exact match to CHAOS COMBAT's spreadsheet **has not been reconciled**, per owner instruction.

## Release recommendation

**HOLD, DRAFT PR only.** Validate CI on the exact SHA, review privacy and import behavior, complete backend durable-batch design if pilot requires it, verify backup, and obtain explicit `APPROVE DEPLOY` for a future release. Never connect this isolated test workflow to live Supabase secrets.
