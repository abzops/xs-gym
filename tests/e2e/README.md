# End-to-end tests

A real-user run of XS Gym on **phone (393×852, touch)**, **tablet (820×1180, touch)** and
**laptop (1440×900)**, 39 steps each: sign-up, gym setup, plans, members, sales with
discount, payments (double-tap, overpayment, network failure), receipts, check-ins and
overrides, reversals, voids, archive/restore, expenses, reports and CSV, settings, staff,
import, appearance, back button, deep-link refresh, sign-out, tenant isolation, and the
76-member demo gym.

```bash
tests/e2e/run.sh            # all three
tests/e2e/run.sh phone      # one platform
```

What runs, all on this machine:

| Piece | File | Notes |
|---|---|---|
| Database | `start_db.sh` | PostgreSQL 16 with `tests/db/supabase_shim.sql`, every migration, and the rich demo seed. Schema, functions, triggers, views and policies were checked identical to the live project. |
| API | `server.mjs` | Supabase-compatible subset: PostgREST reads (embeds, `!inner`, filters, one-to-one detection), RPC calls as `anon`/`authenticated` with RLS and `auth.uid()`, and password auth. Logs every call to `calls.jsonl`. |
| Host | `pages_server.py` | Serves the build like GitHub Pages, including `404.html` for deep links. |
| Test | `e2e.py` | Python Playwright. Asserts the UI and the ledger in Postgres after money actions. Screenshots in `out/<platform>/`. |

The demo login password comes from `DEMO_PASSWORD` (default `demo-password`); the real one is never stored here.
