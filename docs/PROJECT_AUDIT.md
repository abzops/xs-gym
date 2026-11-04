# XS Gym — Phase 0 Project Audit

| | |
|---|---|
| Document | XS-GYM-AUDIT-001 |
| Phase | 0 — Repository and brand discovery |
| Date | 05 November 2026 |
| Specification | `docs/source/XS_Gym_End_to_End_Engineering_Blueprint.md` (XS-GYM-ENG-001 v1.0, SHA-256 `f817be83…d94973c`) |
| Status | **Awaiting owner review** (Phase 0 exit gate) |

## 1. Summary

1. **This is a greenfield project.** No application code, Git repository,
   package manifest, deployment configuration or existing website source was
   supplied or found. Nothing existing will be overwritten.
2. **The brand kit is usable but partial.** All raster logos and the vector-master
   PDF were supplied. The SVG masters, colour token files and font files that the
   brand guide lists in its delivery kit were not. The SVGs were recovered
   losslessly from the vector PDF; fonts are available under the same OFL licence
   from npm; colour values are fully specified in the guide.
3. **The blueprint is sound, but 13 points need a decision or correction** before
   schema work begins (section 6). The most consequential: a naming clash between
   staff access and member memberships, a missing charges/dues ledger, undefined
   membership end-date arithmetic, and hosting constraints of GitHub Pages.
4. **This workspace cannot reach Supabase or Docker registries.** Database logic and
   row-level security can still be built and tested here against a real
   PostgreSQL 16, but full-stack verification must run in CI or on a machine that
   can run the Supabase local stack (section 7).

## 2. Inventory

All supplied files are in the repository unchanged. Checksums:
`brand/SHA256SUMS`, `docs/source/SHA256SUMS`.

| File | Type | Size | Notes |
|---|---|---|---|
| `XS_Gym_End_to_End_Engineering_Blueprint.md` | Spec | 86 KB | Primary specification. Copied to `docs/source/`. |
| `Xelorsoft-Brand-Guide.pdf` | 8-page A4 PDF | 46 KB | Identity v1.0, P6 confirmed, 20 Oct 2026. |
| `Xelorsoft-Vector-Masters.pdf` | 3-page PDF | 9 KB | Pure vector paths, no raster, no text. |
| `Xelorsoft-Primary-Night.png` / `-Light.png` | 4096×1412 | 219 KB each | Full lockup on Carbon / Porcelain. |
| `Xelorsoft-Black-Transparent.png` / `White-Transparent.png` | 4096×1412 RGBA | 118 / 100 KB | Full lockup, transparent. |
| `Xelorsoft-Wordmark-Black.png` / `-White.png` | 4096×1092 RGBA | 107 / 95 KB | Wordmark only, transparent. |
| `Xelorsoft-Icon-Night.png` / `-Light.png` | 1024×1024 | 48 KB each | Badge on Carbon / Porcelain background. |
| `Xelorsoft-Icon-Black-Transparent.png` / `White-Transparent.png` | 1024×1024 RGBA | 28 / 23 KB | Badge only, transparent. |
| `Xelorsoft-Icon-{16,32,64,180,192,512}.png` | Square | 0.4–17 KB | Night variant. 180 = Apple touch, 192/512 = PWA. |

No duplicate files (all 19 SHA-256 hashes distinct). The three files also present
in the home directory are byte-identical to the uploads.

## 3. Brand kit: promised vs received

The guide's delivery page (p. 8) lists seven folders.

| Kit folder | Guide says it contains | Received | Action |
|---|---|---|---|
| `01_Logos` | SVG masters, 4096 px PNGs, transparent logos, icon sizes, vector PDF | PNGs, icons, vector PDF. **No SVGs.** | SVGs recovered from vector PDF → `brand/derived/svg/`, verified pixel-identical. Replace if originals exist. |
| `02_Colors` | Palette JSON, CSS tokens | **Not received** | Use guide values (below). Generate tokens in Phase 3. |
| `03_Typography` | Manrope, IBM Plex Mono files + OFL licences | **Not received** | Self-host from `@fontsource/manrope` and `@fontsource/ibm-plex-mono` (OFL 1.1). |
| `04_Social` | Social templates | Not received | Not needed for the app. |
| `05_Stationery` | Letterhead, cards, email signature | Not received | Not needed. Receipt layout may borrow from letterhead later. |
| `06_Brand_Guide` | The guide | Received | — |
| `07_Source` | Geometry, component paths, build scripts | Not received | Not needed if SVGs are confirmed. |

## 4. Brand specification extracted (source of truth for tokens)

**Colour** — digital HEX is the source of truth (guide p. 5). Pixel sampling of the
PNGs confirms these exact values.

| Token | Hex | Use per guide | Contrast |
|---|---|---|---|
| Carbon | `#171719` | Primary backgrounds, primary text | 16.54:1 on Porcelain — passes AAA |
| Porcelain | `#F6F6F4` | Logo foreground, light surfaces | — |
| Silver | `#B7B7BD` | Dividers, secondary details on dark | 8.97:1 on Carbon (passes). **1.84:1 on Porcelain — fails AA for any text**, matching the guide's warning. |

**Typography** (p. 6): headings Manrope SemiBold, body Manrope Regular, labels
IBM Plex Mono Regular. The logo is outlined artwork — never typeset the name.

**Logo rules** (p. 3–4): badge 368×368 units, corner radius 64; signature dot radius
10, 12-unit gap after "t", baseline-aligned; clear space ≥ 64 units; minimum full
logo width 180 px; minimum icon export 32 px (48+ preferred). No stretching,
outlines, effects, moving the dot or filling the XS knockout. Use the icon alone
for avatars, app tiles and favicons.

**Voice** (p. 6): direct, specific, evidence over superlatives. Descriptor
"AI. Software. Digital." stays separate from the logo.

## 5. Asset findings

| # | Finding | Impact | Proposed handling |
|---|---|---|---|
| A1 | SVG masters missing (guide names `Primary-Night.svg` as preferred master). | Low — recovered. | Use `brand/derived/svg/`. Owner to confirm or supply originals. |
| A2 | `Primary-Night.png` and `Primary-Light.png` have a 1-px semi-transparent row at top and bottom (alpha 234, 8,192 pixels). | Faint line if placed on a contrasting background. | App uses SVG, not these PNGs. Flag to brand owner. |
| A3 | `Icon-16.png` is below the guide's 32 px minimum icon export. | Legibility only. | Use only inside a multi-size `favicon.ico`; 32 px is the smallest standalone icon. |
| A4 | No maskable PWA icon. In `Icon-Night` the badge spans 72 % of the canvas; Android's maskable safe zone is a centred circle of 80 % diameter, so badge corners would be cropped. | Android home-screen icon would be clipped. | Phase 5: export a maskable variant from the SVG with the badge scaled into the safe zone. A re-export, not a redesign — owner approval requested. |
| A5 | The guide's own PDF embeds **Manrope ExtraLight** for display headings, but the written rule says **SemiBold**. | Ambiguous heading weight. | Follow the written rule (SemiBold). ExtraLight also fails readability at small sizes. Owner to confirm. |
| A6 | The palette is strictly monochrome. An operations app needs status colours (paid, due, expiring, expired, error). | Colour-blind-safe status cues needed. | Add restrained **functional** tokens (success, warning, danger, info) used only for state, always paired with an icon and text. Not brand colours. Owner approval requested. |
| A7 | No gym-specific identity for the pilot gym. | — | Per blueprint §3.6: XS Gym product theme on the Xelorsoft identity. Gym logo appears only on receipts and the tenant header. |

## 6. Blueprint review: gaps and corrections

These do not change the blueprint's intent. Each is resolved in the planning docs
or listed in `docs/OWNER_DECISIONS.md`.

| # | Blueprint point | Issue | Resolution |
|---|---|---|---|
| B1 | §7.1 `gym_memberships` (staff ↔ gym) vs §7.2 `member_memberships` | Two "membership" tables for unrelated concepts invites cross-wired joins and RLS mistakes. | Rename staff access table to **`gym_staff`**. ADR-0008. |
| B2 | §2.5 outstanding dues | Schema has payments but nothing that records **what is owed**. Dues cannot be computed from payments alone. | Add a **charges ledger** (`charges`) with `payment_allocations`. ADR-0003. |
| B3 | §2.3 membership end dates | Inclusive vs exclusive end date and the month-end rule (31 Jan + 1 month) are undefined. | Proposed rule with test vectors in `DATABASE.md` §5. **Owner decision D-03.** |
| B4 | §2.3 renewals | Whether an early or late renewal starts from the old end date or from the payment date is undefined. | **Owner decision D-04.** |
| B5 | §5.2 GitHub Pages | On GitHub Free, Pages works only for **public** repositories (source code public). Pages cannot send HTTP headers: no CSP `frame-ancestors`, no `Permissions-Policy`, no HSTS header. Deep links need a 404 workaround. | Cloudflare Pages was the alternative (free, private repo, `_headers`). **Owner decided D-01: GitHub Pages** on `abzops/xs-gym`; constraints handled in ADR-0005 and `SECURITY.md` §7. |
| B6 | §5.3, §20 Supabase Free | Verified 05 Nov 2026: no backups on Free; projects pause after 1 week of inactivity; Pro from $25/month includes daily backups kept 7 days. | Pilot can develop on Free. **Before go-live:** Pro, or scheduled encrypted off-site dumps plus a tested restore. **Owner decision D-09.** |
| B7 | §11.2 trial expiry: "block paid features" | Every operational feature is paid, so this could mean full lock-out. | Recommended: expired tenant becomes **read-only** with export and billing available. **Owner decision D-06.** |
| B8 | §8.1 auth | Front-desk tablets are often shared; staff may not have email addresses. Shared logins break the audit trail. | Individual accounts required. Sign-in method is **owner decision D-05**. |
| B9 | §9, §10 AI gateway | Not explicit that Edge Functions must query the database **as the signed-in user**. Using the service-role key there would bypass RLS. | Rule: AI and action functions forward the user's JWT; service role only for platform admin and webhooks. `SECURITY.md` §4. |
| B10 | §11.4 entitlements | Entitlement checks scheduled for Phase 8, but every write path is built in Phase 4. Retrofitting is error-prone. | Entitlement check built into the shared authorisation function in Phase 3, initially returning "trial active". ADR-0002. |
| B11 | §2.11 collections report | How a reversal on 5 Nov of a payment made on 2 Nov is reported is undefined. | Payments count on their receipt date; reversals count on their reversal date; report shows gross, reversals, net. `PRODUCT_REQUIREMENTS.md` §4. |
| B12 | §2.2 member ID "generated by the backend" | The pilot gym probably has existing register numbers. | Backend generates IDs for new members; import may keep a `legacy_member_no`. **Owner decision D-08.** |
| B13 | §10 AI privacy | Answering "who expires this week?" sends member names to an external model by default. | Tool results pass opaque references to the model; the UI resolves names locally. Names reach the model only where needed (disambiguation). `AI_AND_VOICE.md` §3. |

## 7. Environment and constraints

**Toolchain available in this workspace**

| Tool | Version | Use |
|---|---|---|
| Node.js / npm | 22.23.4 / 10.9.9 | Frontend build and tests |
| Git | 2.43.0 | Version control (no remote configured) |
| PostgreSQL | 16.15 (server + client binaries) | Migrations, RLS and money tests |
| Playwright | 1.63.0, browsers in `/opt/pw-browsers`; Google Chrome | E2E, responsive, accessibility |
| Python | 3.13 | Asset tooling only |
| Docker | CLI only — **no daemon** | Cannot run Supabase local stack |
| Supabase CLI, Deno | **Not installed** | Edge Functions cannot run here yet |

**Network**

| Destination | Reachable | Effect |
|---|---|---|
| npm registry | Yes | Dependencies install normally |
| supabase.com / Supabase projects | **No** (proxy 403) | Cannot create, link or deploy to a hosted project from here |
| GitHub releases, Docker registries | **No** | Supabase CLI binary and local-stack images cannot download |
| GitHub (API via `gh`) | No valid token configured | Cannot create or push a remote repo from here |
| `xelorsoft.com`, `gym.xelorsoft.com` | Does not resolve from here | Domain ownership and DNS unverified |

**Consequence for delivery.** Database work is tested here against PostgreSQL 16
with a minimal stand-in for Supabase's `auth` schema (`auth.uid()`, JWT claims,
`anon`/`authenticated`/`service_role` roles). That catches most RLS and logic
defects, but it is a stand-in. **The authoritative gate is CI** (GitHub Actions,
which can run the real Supabase local stack in Docker) or a hosted staging
project. No phase is signed off on stand-in results alone. ADR-0006.

## 8. Secrets check

All supplied files were scanned for common credential patterns (Supabase JWTs and
service-role keys, Google, OpenAI-style, Groq, GitHub, Slack and Razorpay keys,
private-key blocks). **No matches.** `.gitignore` excludes `.env*`, key files,
database dumps and export folders before the first commit.

## 9. What is reused and what will be created

**Reused as-is:** brand guide rules, colour values, all raster logos, PWA icon
sizes 192/512, Apple touch icon 180, favicon 32/64.

**Derived (non-creative, from official artwork):** three SVG masters (done);
maskable icon and multi-size `favicon.ico` (Phase 5, after approval).

**Created new:** the entire application, database, tests and documentation.

## 10. Phase 0 exit gate

- [x] Repository and asset inventory complete
- [x] Brand rules and tokens extracted and verified
- [x] Secrets scan clean
- [x] Environment limits documented with workaround
- [x] Implementation plan and design docs drafted (`docs/IMPLEMENTATION_PLAN.md`)
- [ ] **Owner reviews this audit and the plan**
- [x] Hosting decided: GitHub Pages (D-01)
- [ ] **Owner answers blocking decisions D-02 to D-05** (`docs/OWNER_DECISIONS.md`)
