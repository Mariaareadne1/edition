# Edition — progress

- Repo: https://github.com/Mariaareadne1/edition · branch `main`
- Local: ~/Developer/design-engineering-build-2026/edition
- Live: https://mariaareadne1.github.io/edition/ (GitHub Pages via .github/workflows/pages.yml)

## Milestones
- [x] E0 repo, model (README), notices, fixtures generated in code, sample through the real pipeline
- [x] E1 deterministic separation, unit-tested (white/black/ramp/colours/alpha/bounds)
- [x] E2 exact-area halftone, plate transforms, overprint composite; drag + numeric registration
- [x] E3 import (validated), views, undo/redo, IndexedDB persistence with byte-identical reload
- [x] E4 full-resolution PNG export in a worker; PNGs decoded and checked in tests; preview parity
- [x] E5 visual pass, responsive, a11y basics, docs, screenshots, Pages deploy

## Test results (2026-10-21)
`pnpm test` 25/25 · `pnpm test:e2e` 13/13 Chromium + 13/13 WebKit · typecheck, lint, build pass.

## Independent review (2026-10-21) — fixed
Boot read failure could let autosave overwrite the saved print and prune its image → unreadable record is
copied aside and only blobs this session replaced are ever deleted; worker crashes hung the pool → crashed
workers are replaced and the render retried; compare view's source render could drop the print render →
separate latest-wins lanes; zip-bomb in .edition import → per-entry size filter; pixel limit checked after
decode → header dimensions checked first (PNG/JPEG/WebP); stale settings captured during import; no flush
on pagehide; arrow-key repeats flooded undo; cancel shown as an error; failed IndexedDB open cached.

## Known gaps
- Firefox and real phones untested; only a 17.5 MP import exercised.
- Plate drag re-renders both plates; a per-plate cache would make dragging cheaper on slow machines.
- No dot-shape options (round only) and no stochastic screen — deliberately out of scope.
