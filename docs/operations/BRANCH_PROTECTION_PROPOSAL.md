# XS Gym — Proposed release protection for `main`

**Date:** 2026-11-11 | **Status:** DRAFT; owner review required; **NOT APPLIED**  
**Observed GitHub metadata:** `main` is currently `protected=false`; `.github/workflows/pages.yml` publishes `gh-pages` on successful push to `main`. This is a production trigger.

## Recommended `main` branch rule

| Setting | Proposed selection | Reason |
|---|---|---|
| Branch name | `main` only initially | Do not block Actions' `gh-pages` output branch |
| Require pull request | ON | No direct pushes to the deployment branch |
| Approving reviews | **1 independent reviewer**, after a second trusted contributor is available | Self-review cannot satisfy an independent reviewer gate |
| Dismiss stale approvals | ON | A new commit must receive review |
| Approval of latest reviewable push | ON, if team workflow supports it | Stops unreviewed final changes |
| Required status checks | ON, strict/up-to-date | Enforce current PR head is tested against `main` |
| Required checks (planned shared workflow) | `xs/quality`, `xs/database`, `xs/security`, `xs/phone`, `xs/tablet`, `xs/laptop`, `xs/restore-synthetic` | Every PR must report unambiguous checks; **these names do not yet exist** |
| Require conversation resolution | ON | No unresolved review issues |
| Allow force pushes | OFF | Preserve deployment branch history |
| Allow branch deletion | OFF | Protect production source |
| Enforce restrictions on admins | ON when practical | No unreviewed bypass |
| Require linear history | Recommended if fast-forward/squash is preferred | Reduces difficult rollback history |
| Required signed commits | DEFER until every author can sign | Avoid accidental release deadlock |
| Allow bypass actors | NONE except necessary break-glass maintenance policy approved by owner | Protect owner workflow |
| Production deployment | Separate manually approved release workflow, not `push main` | Tests and merge are not deployment authorization |

**Important:** The proposed status check labels are *future target names*, not the names of checks currently published by CI. Do **not** enable those specific required checks before a stable unified workflow has been added and verified on PRs. This would deadlock merges.

## Current relevant checks

PR #3 currently runs `XS Gym pilot isolated safety checks` and its six jobs: `Static app, unit and security tests`, `Two-tenant isolated PostgreSQL safety tests`, `Synthetic database backup and restore drill`, `Synthetic phone end-to-end`, `Synthetic tablet end-to-end`, `Synthetic laptop end-to-end`.

The separate member-import branch runs an independent CI workflow with intentionally different names. Consolidate into one common, credential-free PR gate **before** enforcing a global required-check list.

## Proposed rollout sequence — OWNER APPROVAL REQUIRED for every configuration change

1. Owner confirms whether a second independent reviewer can be granted the necessary GitHub repo permissions. With one contributor only, requiring one review would block all merges. If none is available, use PR + mandatory checks + an external documented owner review, and accept the reduced GitHub enforcement until a reviewer joins.
2. On a separate `feature/*` branch, prepare a unified, nondeploying PR test workflow with the seven stable check names; tests use disposable synthetic database only.
3. Test the PR workflow from a test PR; ensure status names are unique across workflows and all required checks are reliably produced.
4. Independently prepare a **manual release** workflow with an exact commit/tag parameter, checksum, owner approval recorded in release notes, and a rollback method. Production environment required reviewers are preferred if available on the repo/plan. Never put production secrets in PR workflows.
5. After step 2-4 are verified and owner explicitly authorizes configuration edits, enable protection on `main` and disable push-triggered production deploy. **Settings have not been changed.**
6. Validate that a direct push is rejected, an unreviewed PR is rejected, all checks are enforced, and a manually approved release is the only deploy path. Test on a safe nonproduction target first.
7. Document who can approve a break-glass recovery and how the owner can undo a bad rule without destroying deployment history.

## Owner approval questions

- Who is the independent reviewer for PRs? Or do you authorize temporarily requiring 0 GitHub reviewer approvals but manually reviewing every PR?
- Should production releases require `APPROVE DEPLOY` in chat **and** an explicit GitHub workflow dispatch, or an environment reviewer gate when available?
- Who can execute an emergency rollback and how is that activity audited?

References: [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches) and [GitHub ruleset settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets).

**Decision: HOLD — do not enable any setting until specifically approved.**
