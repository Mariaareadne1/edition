# Decisions

## D1 — A hand-written engine on typed arrays, not wasm-vips or canvas blending
wasm-vips (LGPL-2.1+ with many bundled notices, ~5 MB of wasm) is excellent for resampling and format
work, but Edition's core operations — OKLab separation, an exact-area rotated halftone, per-plate
transforms, a transmission composite — are custom per-pixel functions vips does not provide. CSS/canvas
blend modes can't express the model and differ by browser. A ~400-line TypeScript engine is portable,
testable in Node, and renders A4/300 dpi in ~1.7 s single-threaded.

## D2 — One renderer, defined in sheet units
Preview, export and films are the same `renderRows` call at different pixel scales. Every size (cells,
offsets, grain, marks, margin) is a fraction of the sheet's long edge, which is why a 542 px proof and a
3508 px export agree to 0.15/255 when compared over the same regions in linear light.

## D3 — Exact-area dots with analytic anti-aliasing
The dot radius comes from inverting the area of a circle clipped to its cell, so coverage is exact and
monotonic, including past the point where dots touch (≈ 78.5 %). Supersampling is used only where cells
are smaller than 8 px; above that the analytic edge ramp is as accurate (measured within 2 %) and 4–9×
cheaper.

## D4 — Workers: a latest-wins preview pool plus a separate export worker
Up to four workers render horizontal bands of each proof; while one proof is in flight, newer requests
replace each other so a slider drag never queues stale work (tested). The sample is painted once and
shared. Export runs in its own worker with progress and cancellation so the preview stays live. The pool
is created inside an effect: creating it in a state initialiser let StrictMode's simulated unmount
terminate the workers of the pool that was then reused.

## D5 — Original image bytes in IndexedDB as ArrayBuffer
Reloading regenerates the identical proof from the original file, not a cached render. Bytes are stored
as ArrayBuffer + type because WebKit cannot store Blobs in IndexedDB in ephemeral sessions.

## D6 — Films are registered
`ink-1.png` / `ink-2.png` are what you would expose a plate or screen from, so they ignore the on-press
misregistration, which only appears in the composite. Tested both ways.

## D7 — Print Room layout: the Press Table, not a drawer (redesign E1, 2026-10-25)
Two arrangements were built with the real, wired controls and compared at 1440×900 and 390×844
(`docs/redesign/e1-*.jpg`). **A — Press Table**: title and view index set in the table's left margin, the
sheet centred with its plate tabs on its right edge, one card of stock (the ink tray) on the right.
**B — Collapsible Ink Drawer**: the same, with the tray hidden behind an *Adjust* button. The sheet is
height-bound, so B did not make the print any larger (614 × 742 px in both); it only hid the plate
controls one click away, and when open it covered the plate tabs and part of the print. A was chosen: same
art dominance, every essential control visible, no occlusion, two objects on the table instead of three
permanent panels. B's pattern survives where it earns its place — on phones the tray is a bottom sheet.

## D8 — Editor and presentation state live outside the document
`state/useStudio.ts` holds the view, the plate in hand, the loupe, the lifted plates, the tray/drawer and
the onboarding hint. None of it enters `EditionDocument`, the undo history or an export, so changing
tools can never create an undo step and the print's pixels depend only on `PrintSettings`. Plate offsets
have exactly one home (`settings.registration`): the drag, the arrow keys, the numeric fields, the plate
tabs' readout and the register pad all read and write it.

## D9 — A real loupe: the export's own pixels
The loupe asks the worker pool (its own latest-wins lane) for the rows under the pointer at the A4/300 dpi
export size, cropped to the glass in the worker, and draws them with smoothing off at 1 or 2 device pixels
per exported pixel. It is the same `renderRows` call as the export, not a zoomed preview or a texture.
The engine is unchanged; rows are rendered full-width and cropped (≈0.1–0.2 s per move at 1:1).

## D10 — Default working pair: Cobalt × Vermilion on museum stock
New documents start on a fourth recipe, *Cobalt & Vermilion* (`#1b3fbf`, `#f23b1d`) on `#efe7d8` paper.
The three original recipes, paper tones and custom colours are unchanged, and saved documents keep their
own inks. The golden-output test freezes the pre-redesign settings so it keeps guarding the engine rather
than the default palette.
