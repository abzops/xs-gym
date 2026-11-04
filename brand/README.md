# Brand assets

Official Xelorsoft identity, version 1.0 (P6 confirmed, 20 October 2026). Do not
redesign, recolour, stretch or retype the logo. See `source/Xelorsoft-Brand-Guide.pdf`.

## `source/` — as supplied by the owner (do not edit)

Byte-identical copies of the files supplied on 05 Nov 2026. Checksums in
`SHA256SUMS`. Verify with `cd brand/source && sha256sum -c ../SHA256SUMS`.

## `derived/svg/` — recovered vector masters (pending owner confirmation)

The brand guide names `Xelorsoft-Primary-Night.svg` as the preferred master, but
the SVG files were not in the supplied kit. These three SVGs were recovered
losslessly from `source/Xelorsoft-Vector-Masters.pdf` (pure vector, no raster):

| File | From PDF page | Verified against |
|---|---|---|
| `Xelorsoft-Primary-Night.svg` | 1 | `Xelorsoft-Primary-Night.png` — 10 of 5.8M pixels differ (anti-aliasing only) |
| `Xelorsoft-Primary-Light.svg` | 2 | `Xelorsoft-Primary-Light.png` — same |
| `Xelorsoft-Icon-Night.svg` | 3 | `Xelorsoft-Icon-Night.png` — 0 pixels differ |

Changes made during recovery: `rgb(%)` colour notation converted to the exact
brand hex values (`#171719` Carbon, `#F6F6F4` Porcelain), redundant
`fill-opacity="1"` and the unused `xlink` namespace removed, a `<title>` added.
Path geometry is untouched. The icon badge measures 368 × 368 units with a 64-unit
corner radius, matching the guide's construction spec.

**If the original `01_Logos/*.svg` masters exist, supply them and they replace these.**

## Not supplied (listed in the brand guide's delivery page)

- `02_Colors` palette JSON and CSS tokens — values taken from the guide instead.
- `03_Typography` font files and OFL licences — the app will self-host Manrope and
  IBM Plex Mono from the `@fontsource` npm packages (same OFL upstream).
- `04_Social`, `05_Stationery`, `07_Source` — not needed for the app.
