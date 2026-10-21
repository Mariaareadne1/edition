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
