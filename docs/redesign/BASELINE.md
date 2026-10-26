# Print Room redesign — E0 baseline (2026-10-25)

Measured fresh on `main` @ 2b1f395 before any UI change.

## Commands
| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ok (pnpm 10.33.2) |
| `pnpm typecheck` · `pnpm lint` · `pnpm build` | pass · pass · pass (JS 279.7 kB / 90.5 kB gz) |
| `pnpm test` | 25 / 25 |
| `pnpm test:e2e` | 13 / 13 Chromium, 13 / 13 WebKit (1.7 min) |
| Export parity (A4/300 composite vs proof, linear-light 16 px blocks) | Chromium mean 0.15/255, worst 0.97 (542 px proof) · WebKit mean 0.37/255, worst 2.96 (1083 px proof) |

## Golden fixture outputs
`tests/unit/golden.test.ts` renders five code-generated fixtures — grey ramp, flat swatches (incl. the
accent coral and its teal complement), hard diagonal edges, a partially transparent PNG-style disc, and a
detailed lit-sphere "photograph" — through the real engine in `print`, `film1`, `film2`, `source` at a
600 px long edge, and locks FNV hashes, dimensions and film coverage in `tests/unit/golden.json`.
The redesign must not change these. (E.g. grey ramp 600×428, coverage key 0.2819 / accent 0.0011 — the
accent value is the registration marks alone.)

## Module map (verified paths)
```
image/import.ts        validation (size, magic bytes, header dimensions) → decode → downscale to ≤1800 px
storage/db.ts          IndexedDB: docs store (current + unreadable-* copies) and blobs store (original bytes)
state/document.ts      versioned schema v1, palettes, limits, parse/validate
state/history.ts       undo/redo with gesture coalescing (preview… commit = one step)
state/useEdition.ts    reducer, boot/restore, autosave, .edition/.json import + export
engine/separations.ts  OKLab separation → key + accent coverage maps
engine/halftone.ts     exact-area dot radius, supersampling policy
engine/render.ts       sheetLayout (sheet units, 297 mm long edge), rasterizePlate (registration applied
                       in plate frame), composite, films, marks
worker/render.worker.ts  owns source + maps; renders row bands; export job (PNG via OffscreenCanvas)
worker/pool.ts         latest-wins preview pool (proof + source lanes), crash recovery, runExport w/ cancel
ui/*                   TopBar, PlateStack (left), PrintCanvas (centre), Inspector (right), PaletteStrip, ExportDialog, Field
```
Source of truth: `history.present.settings` (one `PrintSettings`) — drag, numeric fields and keyboard
all write it; the canvas renders from it; there is no duplicated offset state.

## Observed UX / accessibility defects
- Three-column editor; the print is ~37 % of a 1440 px viewport and every control is permanently visible.
- "Loupe" is a 2.2× CSS zoom of the preview canvas, not the output resolution — it cannot show real dot structure.
- Hint text `#8a847a` on `#efebe2` ≈ 3.1:1 — below WCAG AA for small text.
- Phone: plate/registration controls are ~1500 px below the print; palettes wrap; no tool tray.
- Compare slider lives outside the sheet; split is a separate range input only.
- Plate chips ("On", "Solo") are ~28 px tall — under the 44 px touch target guideline.

Screenshots: `docs/redesign/before-1440.jpg`, `before-390.jpg`; full set and videos via
`node scripts/capture.mjs before` (written to git-ignored `artifacts/`).
