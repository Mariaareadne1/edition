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
`pnpm test` 20/20 · `pnpm test:e2e` 10/10 Chromium + 10/10 WebKit · typecheck, lint, build pass.

## Known gaps
- Firefox and real phones untested; only a 17.5 MP import exercised.
- Plate drag re-renders both plates; a per-plate cache would make dragging cheaper on slow machines.
- No dot-shape options (round only) and no stochastic screen — deliberately out of scope.
