# ADR-0005 — Frontend hosting on GitHub Pages

**Status:** Accepted (owner decision D-01) · 05 Nov 2026

**Context.** Blueprint proposes GitHub Pages "if its constraints fit". Verified
05 Nov 2026: on GitHub Free, Pages works only for public repositories; Pages
cannot set custom HTTP headers (CSP `frame-ancestors`, HSTS, Permissions-Policy);
there are no rewrites for SPA deep links. Cloudflare Pages was offered as an
alternative (free, private repo, `_headers`, SPA fallback).

**Decision.** Owner chose GitHub Pages on `abzops/xs-gym`. Deploy with GitHub
Actions; `404.html` fallback for deep links; configurable `VITE_BASE_PATH`;
`<meta>` CSP plus frame-busting check (`SECURITY.md` §7).

**Consequences.** Source code is public unless the plan is upgraded — acceptable
because no secrets are in the repo and all enforcement is server-side. Missing
headers are an accepted risk, revisitable by putting a Cloudflare proxy in front
without changing the host.
