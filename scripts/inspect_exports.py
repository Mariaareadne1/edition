"""
Independent check of Edition's exported files, outside the JavaScript toolchain.

    python3 scripts/inspect_exports.py <dir> [--dx 0.6 --dy -0.4]

<dir> holds print-composite.png, ink-1.png and ink-2.png (any prefix). Reports
sizes, film properties and coverage, inked bounds, and measures where each
plate's registration marks land in the composite relative to the same marks
on its registered film. Averaged over the four marks (top, bottom, left,
right of the sheet centre) the rotation from skew cancels, leaving the
plate's offset — which must equal the configured register. Needs Pillow
and numpy.
"""
import argparse
import pathlib
import sys

import numpy as np
from PIL import Image

SHEET_MM = 297.0


def load(d: pathlib.Path, suffix: str) -> np.ndarray:
    files = sorted(d.glob(f"*{suffix}"))
    if not files:
        sys.exit(f"no *{suffix} in {d}")
    return np.asarray(Image.open(files[-1]).convert("RGB"), dtype=np.float64)


def centroid(weight: np.ndarray) -> tuple[float, float]:
    ys, xs = np.mgrid[0 : weight.shape[0], 0 : weight.shape[1]]
    t = weight.sum()
    return (float((xs * weight).sum() / t), float((ys * weight).sum() / t))


def mark_windows(w: int, h: int, margin: float) -> list[tuple[slice, slice]]:
    """Windows around the four registration marks (render.ts markPositions, sheet units → px)."""
    L = max(w, h)
    gap = margin / 2 * L
    half = int(margin * 0.28 * 1.2 * L) + 14  # the mark's extent (render.ts) plus ~1.2 mm of misregistration, clear of the image
    centres = [(w / 2, gap), (w / 2, h - gap), (gap, h / 2), (w - gap, h / 2)]
    return [(slice(int(cy - half), int(cy + half)), slice(int(cx - half), int(cx + half))) for cx, cy in centres]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=pathlib.Path)
    ap.add_argument("--dx", type=float, nargs=2, default=None, help="expected dx (mm) for plate 1 and 2")
    ap.add_argument("--dy", type=float, nargs=2, default=None, help="expected dy (mm) for plate 1 and 2")
    ap.add_argument("--margin", type=float, default=0.07, help="paper margin as a fraction of the long edge")
    a = ap.parse_args()

    comp = load(a.dir, "print-composite.png")
    films = [load(a.dir, "ink-1.png"), load(a.dir, "ink-2.png")]
    h, w = comp.shape[:2]
    px_per_mm = max(w, h) / SHEET_MM
    print(f"composite {w}×{h} px · {w / px_per_mm:.0f}×{h / px_per_mm:.0f} mm · {px_per_mm * 25.4:.0f} dpi")

    ok = True
    for k, f in enumerate(films, 1):
        same = f.shape == comp.shape
        grey = bool(np.all(f[..., 0] == f[..., 1]) and np.all(f[..., 1] == f[..., 2]))
        cov = 1 - f[..., 0] / 255
        ys, xs = np.nonzero(cov > 0.5)
        print(f"ink-{k}: same size {same} · greyscale {grey} · coverage {cov.mean():.4f} · "
              f"inked bounds x {xs.min()}–{xs.max()} y {ys.min()}–{ys.max()}")
        ok &= same and grey and cov.max() > 0.5  # every film prints at least its marks

    # Each ink's mark in the composite: cobalt absorbs red; vermilion absorbs green but not red.
    r, g = comp[..., 0], comp[..., 1]
    signals = [np.clip(255 - r, 0, None), np.clip(r - g, 0, None)]
    for k in range(2):
        film_ink = 255 - films[k][..., 0]
        moves = []
        for win in mark_windows(w, h, a.margin):
            fx, fy = centroid(film_ink[win])
            sig = signals[k][win]
            sig = np.where(sig > sig.max() * 0.5, sig, 0)  # the mark's strokes, not paper tint
            cx, cy = centroid(sig)
            moves.append((cx - fx, cy - fy))
        mx, my = np.mean(moves, axis=0)
        line = f"plate {k + 1}: marks moved {mx:+.1f}, {my:+.1f} px = {mx / px_per_mm:+.2f}, {my / px_per_mm:+.2f} mm"
        if a.dx and a.dy:
            ex, ey = a.dx[k] * px_per_mm, a.dy[k] * px_per_mm
            good = abs(mx - ex) <= 1.5 and abs(my - ey) <= 1.5
            line += f" (register {a.dx[k]:+.2f}, {a.dy[k]:+.2f} mm = {ex:+.1f}, {ey:+.1f} px) {'OK' if good else 'MISMATCH'}"
            ok &= good
        print(line)
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
