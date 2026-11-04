# ADR-0002 — All writes through database command functions

**Status:** Proposed · 05 Nov 2026

**Context.** Money, membership and attendance changes must be transactional,
authorised, validated and audited. AI tools must obey the same rules as the UI.
Entitlement checks (blueprint Phase 8) would be error-prone to retrofit (audit B10).

**Decision.** API roles get `SELECT` through RLS only. Every mutation is a
`SECURITY DEFINER` function (`search_path = ''`) that: checks
`private.has_permission`, checks `private.entitlement_ok(…, 'write')`, validates,
enforces the idempotency key, writes, appends `audit_logs`, and returns the stored
row. AI tools and Edge Functions call these same functions with the user's JWT.
`entitlement_ok` exists from Phase 3, returning "trial active" until Phase 8.

**Consequences.** More SQL per feature, but one enforcement point, one round trip
per action, and AI cannot do anything the user could not. Command functions need
thorough DB tests (TEST_PLAN §2–4).
