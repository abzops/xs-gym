# ADR-0001 — Application stack

**Status:** Accepted (follows blueprint §5.2) · 05 Nov 2026

**Context.** Greenfield repo; blueprint specifies a Supabase-first PWA.

**Decision.** React + TypeScript (strict) + Vite; React Router; TanStack Query;
React Hook Form + Zod; Supabase (Postgres, Auth, Storage, Edge Functions);
Vitest, Testing Library, Playwright, axe. Single repository with `src/`,
`supabase/`, `tests/`, `docs/`. Tailwind/shadcn adopted only if they fit the
brand tokens without fighting them (checked in Phase 3).

**Consequences.** Several dependencies are new majors (TypeScript 7, Vite 8,
React Router 8, Zod 4, Vitest 5); compatibility is verified at install and any
pin-back recorded here.
