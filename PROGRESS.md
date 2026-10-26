# Edition — progress

- Repo: https://github.com/Mariaareadne1/edition · redesign branch `redesign/print-room` (merged to `main` when verified)
- Local: ~/Developer/design-engineering-build-2026/edition
- Live: https://mariaareadne1.github.io/edition/ (GitHub Pages via .github/workflows/pages.yml, deploys from `main`)

## Original build (2026-10-21)
- [x] E0–E5: engine, separations, exact-area halftone, registration, import, views, undo/redo, IndexedDB,
      full-size export in a worker, Pages deploy. 25 unit · 13 + 13 e2e.

## Redesign — Edition / The Print Room (2026-10-25 →)
Restart notes: run `pnpm dev`, then `node scripts/capture.mjs <label>` for screenshots (git-ignored
`artifacts/`). Baseline numbers and the module map are in `docs/redesign/BASELINE.md`; design decisions
D7–D10 in `DECISIONS.md`.

- [x] **E0 baseline** — fresh numbers on 2b1f395 (all green; parity 0.15/255 Chromium, 0.37 WebKit);
      golden fixture test (5 fixtures × 4 modes) locks engine output; before screenshots.
- [x] **E1 studies** — Press Table vs Collapsible Ink Drawer built with live controls; Press Table chosen (D7).
- [x] **E2 stage** — print room tokens (table / stock), masthead `EDITION / PRINT ROOM · 01 / TWO INKS`,
      title set on the table, view index (Print · Plate 1 · Plate 2 · Source · Split), sheet sizing with
      room for plate tabs, phone layout with docked rail.
- [x] **E3 tactile tools** — plate tabs on the sheet edge (pick up a plate), direct drag with live mm
      readout and lifted tab, snap cue on exact register, split wipe handle on the sheet (keyboard slider),
      real 300 dpi loupe (own pool lane), hold-to-separate (S or button) showing engine-rendered plates,
      one-time drag hint, pinch cancels a drag with no undo step.
- [x] **E4 workflows** — ink tray (plate ink/on-off, angle, density, register pad + fields, ruling,
      recipes) and workshop drawer (separation, paper); phone bottom sheet with Back/Escape; Save in the
      masthead; export dialog restyled with the same logic.
- [x] **E5 QA** (2026-10-26) — typecheck · lint · build pass; `pnpm test` 29/29; `pnpm test:e2e` 24/24
      Chromium + 23/23 WebKit (1 Chromium-only touch test skipped in WebKit); export parity 0.09/255
      Chromium, 0.29/255 WebKit; loupe = export, 0 differing pixels; five fixtures exported at A4/300 dpi
      and inspected with Pillow (sizes, films, plate offsets from the marks) — all pass. Independent code
      review: no CRITICAL/HIGH; MEDIUM/LOW findings fixed (drag bound to the plate picked up, pointer
      cancel reverts, held-S cleared on blur, phone tray modal + single history pop + focus return,
      menu roles, live-region chatter, Alt/⌘+arrow passthrough, snap cue, IndexedDB reopen).
- [ ] **Publish** — merge to `main` (fast-forward), Pages deploy, verify the live site.

## Known gaps
- Closing and immediately reopening the phone tray can race the asynchronous `history.back()` of the
  previous close and close the new tray (low; reopen works).
- e2e timing is sensitive to machine load: with other projects' suites running (load average 40+),
  Chromium workers were starved and a proof could wait indefinitely — now bounded by a 30 s watchdog.
- Firefox and real phones untested (touch is driven through Chromium's DevTools protocol).
- The loupe renders full sheet rows and crops them (~0.1–0.2 s per move at 1:1); fine on a laptop,
  slower on low-end phones.
- Plate drag re-renders both plates; a per-plate cache would make dragging cheaper on slow machines.
- No dot-shape options (round only) and no stochastic screen — deliberately out of scope.
