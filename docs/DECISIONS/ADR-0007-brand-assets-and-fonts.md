# ADR-0007 — Brand assets, tokens and fonts

**Status:** Proposed — pending owner decision D-10 · 05 Nov 2026

**Context.** SVG masters, token files and font files listed in the brand guide
were not supplied (audit §3).

**Decision.** Use SVGs recovered from the official vector PDF
(`brand/derived/svg/`, pixel-verified). Build CSS tokens from the guide: Carbon
`#171719`, Porcelain `#F6F6F4`, Silver `#B7B7BD` (never for text on light).
Self-host Manrope (SemiBold headings, Regular body) and IBM Plex Mono (labels)
from `@fontsource` — no third-party font requests. Add functional status tokens
(success, warning, danger, info) for state only, always with icon + text. Export a
maskable icon from the SVG for Android.

**Consequences.** No new brand design is invented. If original SVGs or tokens
are supplied they replace the derived ones with no code change beyond file swap.

**Update 05 Nov 2026.** Owner rule: black logo on light backgrounds, white logo on
dark (see `brand/README.md`); the favicon is the transparent badge and adapts to
the browser theme. At the owner's request the UI follows the design rules of the
`taste-skill` (app screens) and `emilkowalski/skills` (motion) skill sets, both
MIT, read as references and not installed: tone steps instead of outlined boxes,
flat fully round buttons, 16 px body text, one dominant figure per screen, no
monospace in the UI (IBM Plex Mono removed), press feedback scale 0.97 / 160 ms,
hover only on fine pointers, drawer curve for sheets, fades kept under reduced motion.
