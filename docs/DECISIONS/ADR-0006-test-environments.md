# ADR-0006 — Test environments given workspace limits

**Status:** Accepted · 05 Nov 2026

**Context.** The build workspace has PostgreSQL 16 but no Docker daemon, no
Supabase CLI, and no network access to Supabase, GitHub releases or Docker
registries (audit §7).

**Decision.** Workspace: unit/component tests and DB tests on real PostgreSQL 16
with a minimal Supabase `auth` stand-in. **CI (GitHub Actions) with the real
Supabase local stack is the authoritative gate** for RLS, command functions and
E2E. Staging project for UAT.

**Consequences.** A phase is signed off only when CI is green. Until push access
works (PROGRESS X1), CI cannot run, so Phase 3+ gates are blocked on it.
