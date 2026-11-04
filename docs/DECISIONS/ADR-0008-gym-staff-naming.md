# ADR-0008 — Rename staff access table to `gym_staff`

**Status:** Accepted · 05 Nov 2026

**Context.** Blueprint names staff-to-gym access `gym_memberships` and member
plan periods `member_memberships` (audit B1). Similar names for unrelated
concepts invite wrong joins and wrong RLS policies.

**Decision.** Staff access table is `gym_staff`. "Membership" refers only to a
member's plan period throughout code, UI and docs.

**Consequences.** Deviation recorded in `DATABASE.md` §9.
