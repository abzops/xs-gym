# XS Gym — Progress and Handover Log

> **Read this first in every new session.** It records exactly where the work
> stands, what is blocked, and the next concrete step. Update it in the same
> commit as the work it describes. Newest log entry at the top of section 6.

## 1. Current position

| | |
|---|---|
| Phase | **0 — Repository and brand discovery** (finishing) → then Phase 1 |
| Phase 0 status | Audit, plan and design drafts done. **Awaiting owner review + push access.** |
| Branch | `main` |
| Remote | `https://github.com/abzops/xs-gym` — **push blocked (403)**, see §3 |
| Hosting | GitHub Pages (owner decision, 05 Nov 2026) |
| Last updated | 05 Nov 2026 |

## 2. Rules for whoever continues

1. The spec is `docs/source/XS_Gym_End_to_End_Engineering_Blueprint.md`. Follow its §0 instructions.
2. Small commits: one logical change each, message `type: summary` (`docs:`, `feat:`, `fix:`, `test:`, `chore:`, `brand:`, `ci:`).
3. Push after every few commits. Update this file in the same commit as the work.
4. Never commit secrets, `.env` files, database dumps or real member data.
5. Do not start a phase until the previous phase's exit gate in `docs/IMPLEMENTATION_PLAN.md` is met.

## 3. Blockers

| # | Blocker | Owner action | Status |
|---|---|---|---|
| X1 | Claude cannot push to `abzops/xs-gym` (GitHub 403). | Install the Claude GitHub App on `abzops` with access to `xs-gym` (<https://github.com/apps/claude/installations/select_target>), or reconnect GitHub in claude.ai connector settings. | Open |
| X2 | This workspace cannot reach `supabase.com` or Docker registries. | Either allow Supabase domains for this workspace (claude.ai → Settings → Capabilities), or rely on CI for full-stack tests. | Open — workaround in ADR-0006 |
| X3 | Blocking business decisions D-02 to D-05. | Answer in `docs/OWNER_DECISIONS.md`. | Open |
| X4 | GitHub Pages on a free plan requires the repo to be **public**. | Make `abzops/xs-gym` public (or upgrade the GitHub plan) and enable Pages → Source: GitHub Actions. | Open |

## 4. Done

| Item | Where |
|---|---|
| Workspace, asset and toolchain inspection | `docs/PROJECT_AUDIT.md` |
| Supplied brand assets, byte-identical, with checksums | `brand/source/`, `brand/SHA256SUMS` |
| SVG masters recovered from the vector PDF and verified | `brand/derived/svg/`, `brand/README.md` |
| Blueprint copied into repo as source spec | `docs/source/` |
| `.gitignore` protecting secrets and member data | `.gitignore` |
| Implementation plan (phases, gates, deps checked 05 Nov 2026, env vars, accounts, costs) | `docs/IMPLEMENTATION_PLAN.md` |
| Owner decisions register (D-01 decided; D-02…D-14 open) | `docs/OWNER_DECISIONS.md` |
| Design drafts: architecture, database, security, AI/voice, tests, deployment, requirements | `docs/*.md` |
| Membership end-date function: 13 test vectors pass on PostgreSQL 16 | `docs/DATABASE.md` §5 |
| ADR-0001…0008 | `docs/DECISIONS/` |
| Status page (brand fonts self-hosted, strict CSP, anti-framing; checked at 360–1366 px) | `site/` |
| GitHub Pages workflow with secret scan | `.github/workflows/pages.yml` |
| README, CHANGELOG; all Markdown lint-clean, 0 broken links | repo root |

## 5. Next steps (in order)

1. **Owner:** fix X1, then push — `git push -u origin main` from this repo (or from
   the bundle: `git clone xs-gym.bundle xs-gym && cd xs-gym && git remote set-url origin https://github.com/abzops/xs-gym && git push -u origin main`).
2. **Owner:** X4 — make repo public, Settings → Pages → Source: GitHub Actions.
   The workflow then publishes `site/` to <https://abzops.github.io/xs-gym/>.
3. **Owner:** review `docs/PROJECT_AUDIT.md` + `docs/IMPLEMENTATION_PLAN.md`
   (Phase 0 exit gate) and answer D-02…D-05 in `docs/OWNER_DECISIONS.md`.
4. **Next session — Phase 1:** use `docs/PRODUCT_REQUIREMENTS.md` §4 discovery kit
   with the pilot gym; write `docs/USER_STORIES.md` and responsive wireframes for
   the top-10 tasks (phone, tablet portrait, tablet landscape, laptop).
5. Do **not** start Phase 3 code until Phase 1 and 2 gates pass.

## 6. Session log

### 2026-11-05 — Session 1

- Inspected all supplied files; workspace had no existing code (greenfield).
- Recovered 3 SVG masters from `Xelorsoft-Vector-Masters.pdf`; pixel-verified against PNGs.
- Found 13 blueprint gaps (audit §6) and 7 asset findings (audit §5).
- Verified: Supabase Free has no backups and pauses after 1 week idle; GitHub Pages
  needs a public repo on free plans and cannot set HTTP security headers.
- Owner chose GitHub Pages and repo `abzops/xs-gym`; push refused (X1).
- Wrote plan, decisions register, 8 design docs and 8 ADRs; tested the date
  function on a throwaway PostgreSQL 16 (13/13 pass).
- Built status page + Pages workflow (action versions from GitHub docs: checkout v6,
  configure-pages v5, upload-pages-artifact v4, deploy-pages v4).
- ~35 small commits on `main`, all local; handed owner a git bundle.
- Workspace note: run throwaway Postgres as user `claude` under `/home/claude`
  (scratchpad parent is not traversable by that user).
