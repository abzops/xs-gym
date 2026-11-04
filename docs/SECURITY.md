# XS Gym — Security and Privacy (Phase 2 draft)

Security is a launch blocker (blueprint §8). This document defines how access is
enforced; `TEST_PLAN.md` §4 defines how it is proven.

## 1. Principles

1. **Default deny.** RLS enabled on every table; no policy means no access.
2. **The database decides.** UI hiding is convenience, never protection.
3. **One write path.** All mutations go through command functions that authorise,
   validate, write and audit in one transaction (ADR-0002). API roles have no
   direct `INSERT/UPDATE/DELETE` on business tables.
4. **Act as the user.** Edge Functions (AI, actions) call the database with the
   caller's JWT so RLS and permissions apply. The service-role key is used only by
   platform-admin functions and webhooks, each audited.
5. **Least data.** Collect only what operations need; send even less to third parties.

## 2. Authentication

Supabase Auth, method per D-05 (recommended: individual email + password). Secure
reset, session refresh, sign-out on all devices. Brute-force protection uses
Supabase's built-in rate limits. MFA for owner and platform admin is a Phase 9
hardening item. Shared logins are not supported.

## 3. Authorisation model

Roles from blueprint §12 map to permission keys in `role_permissions`. Code checks
**permissions**, never role names.

| Permission | Owner | Manager | Reception | Trainer |
|---|---|---|---|---|
| `members.read` | ✓ | ✓ | ✓ | assigned only |
| `members.write` | ✓ | ✓ | ✓ (create, edit contact) | — |
| `members.archive`, `members.export` | ✓ | ✓ | — | — |
| `notes.read` (restricted notes) | ✓ | ✓ | — | assigned only |
| `plans.manage` | ✓ | ✓ | — | — |
| `memberships.sell`, `memberships.renew` | ✓ | ✓ | per policy | — |
| `memberships.freeze`, `memberships.cancel` | ✓ | ✓ | — | — |
| `attendance.checkin` | ✓ | ✓ | ✓ | — |
| `attendance.correct`, `attendance.override` | ✓ | ✓ | — | — |
| `payments.record` | ✓ | ✓ | ✓ | — |
| `payments.read` | ✓ | ✓ | own entries / today | — |
| `payments.reverse`, `discounts.apply` | ✓ | ✓ | — | — |
| `expenses.record`, `expenses.read` | ✓ | ✓ | — | — |
| `reports.operational` | ✓ | ✓ | limited | own metrics |
| `reports.financial` | ✓ | selected | — | — |
| `staff.manage` | ✓ | restricted | — | — |
| `billing.manage` (SaaS) | ✓ | — | — | — |
| `audit.read` | ✓ | — | — | — |

Members (portal) are a later release with their own self-only policies. "Per
policy" cells are confirmed in Phase 1.

## 4. Enforcement

**Helper functions** (in `private`, `SECURITY DEFINER`, `STABLE`, `search_path = ''`):

- `private.staff_gym_ids()` — gyms where `auth.uid()` has an active `gym_staff` row.
- `private.has_permission(gym_id, permission)` — active staff row + role grants it.
- `private.entitlement_ok(gym_id, feature, mode)` — subscription allows the
  feature; `mode` is `read` or `write` (D-06 read-only on expiry).

**Read policies** follow one pattern, with `select` wrappers so Postgres caches the
result per statement:

```sql
create policy members_select on public.members for select to authenticated
using ((select private.has_permission(gym_id, 'members.read'))
       and (select private.entitlement_ok(gym_id, 'members', 'read')));
```

Trainer "assigned only" rules add a join to `trainer_assignments`.

**Command functions** (e.g. `record_payment`) begin with the same checks, take
`p_gym_id` explicitly, never trust it, and raise coded errors (`XS401`, `XS403`,
`XS409`…) without leaking SQL detail. They `revoke execute ... from public, anon`
and grant only to `authenticated`.

**Platform admin** (Xelorsoft) is not a role inside a gym. It is a separate Edge
Function guarded by an allow-list of user IDs plus MFA, using the service role,
with every call written to `audit_logs` as `platform_admin`. No hidden bypass in
ordinary sessions.

## 5. Secrets

- Browser bundle holds only the Supabase URL and publishable key.
- Service-role, AI, voice and payment secrets live in Supabase Edge Function
  secrets and GitHub Actions secrets. Never prefixed `VITE_`.
- `.env.example` holds names only. A leaked key is **rotated**, not just deleted.
- CI runs a secret scan on every push (Phase 3).
- Logs redact tokens, phone numbers and payment references.

## 6. Data classification

| Class | Examples | Rules |
|---|---|---|
| Restricted | Restricted notes, health/injury info (only if D-12 approves), photos, IDs | Private storage + signed URLs, `notes.read`, never sent to AI providers |
| Personal | Name, phone, email, address, DOB, attendance | RLS-scoped; export needs `members.export`; AI sees opaque refs by default |
| Financial | Payments, charges, expenses | Immutable ledger; reversal only; `reports.financial` |
| Operational | Plans, settings, counts | Staff read |

Raw voice audio is not stored. Retention, export and deletion policy is drafted
in Phase 2 and reviewed by counsel before commercial scale (not legal advice).

## 7. Browser security on GitHub Pages (D-01)

GitHub Pages cannot send HTTP response headers, so:

| Control | How |
|---|---|
| Content Security Policy | `<meta http-equiv="Content-Security-Policy">`: `default-src 'self'`; `connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co`; no inline script; `object-src 'none'`; `base-uri 'self'` |
| Clickjacking (`frame-ancestors` unsupported in meta) | App refuses to render when `window.top !== window.self`; sensitive actions need a fresh confirm step |
| HSTS | Pages enforces HTTPS redirects; no HSTS header available. Accepted risk; revisit with a Cloudflare proxy |
| Permissions-Policy | Not settable; microphone requested only on a user gesture inside the voice view |
| XSS | React escaping only; no `dangerouslySetInnerHTML`; CSV export neutralises formulas (`=`, `+`, `-`, `@`) |

## 8. Threat model

| Threat | Mitigation | Proven by |
|---|---|---|
| Cross-tenant read/write | RLS on `gym_id`; composite tenant FKs; command functions re-check | Two-gym test suite, direct API calls |
| IDOR / forged `gym_id` | Membership check on every call; composite FKs | Forged-ID tests |
| Role escalation | `staff.manage` required; owner cannot be demoted by manager | Role tests |
| Duplicate payment on retry | Unique idempotency key; command returns original | Retry tests, double-submit E2E |
| Tampered ledger | No update/delete grants; triggers block mutation | Mutation-attempt tests |
| Forged trial/subscription state | State only in server tables; checked in `entitlement_ok` | Client-tamper tests |
| Service-role exposure | Never in bundle; CI scans `dist/` for key patterns | CI step |
| XSS / CSV injection | Escaping, CSP, export sanitising | Payload tests |
| Malicious upload | Private buckets, type/size allow-list, signed URLs | Upload tests |
| Webhook forgery/replay | Signature check, event-ID uniqueness | Webhook tests (Phase 8) |
| Prompt injection via notes | Notes not given to the model; tools validate server-side; writes need user confirmation | Injection test set (Phase 6) |
| AI tool abuse | Tools run as user; permission + schema checks; confirm token bound to user, args and expiry | Tool permission tests |
| Data leakage to AI providers | Opaque refs, redaction, provider terms review | Context-capture tests |
| Brute-force login | Supabase rate limits; lockout messaging | Manual + config review |
| Backup exposure | Encrypted dumps, private storage, no dumps in Git (`.gitignore`) | Backup drill |
