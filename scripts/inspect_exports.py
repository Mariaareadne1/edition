"""
Independent check of Edition's exported files, outside the JavaScript toolchain.

    python3 scripts/inspect_exports.py <dir> [--dx 0.6 --dy -0.4]

<dir> holds print-composite.png, ink-1.png and ink-2.png (any prefix). Reports
sizes, film properties and coverage, inked bounds, and measures how far each
plate sits in the composite relative to its registered film (phase
correlation on a central crop) — which should equal that plate's offset.
Needs Pillow and numpy.
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


def shift(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    """Translation (x, y) in pixels that moves b onto a, by phase correlation."""
    fa, fb = np.fft.fft2(a - a.mean()), np.fft.fft2(b - b.mean())
    r = fa * np.conj(fb)
    r /= np.abs(r) + 1e-9
    c = np.fft.ifft2(r).real
    y, x = np.unravel_index(np.argmax(c), c.shape)
    h, w = c.shape
    return (x - w if x > w / 2 else x, y - h if y > h / 2 else y)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", type=pathlib.Path)
    ap.add_argument("--dx", type=float, nargs=2, default=None, help="expected dx (mm) for plate 1 and 2")
    ap.add_argument("--dy", type=float, nargs=2, default=None, help="expected dy (mm) for plate 1 and 2")
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
        ok &= same and grey and cov.mean() > 0.001

    # Each ink's signal in the composite: cobalt absorbs red, vermilion absorbs green/blue but not red.
    r, g, b = comp[..., 0], comp[..., 1], comp[..., 2]
    signals = [255 - r, np.clip(r - g, 0, None)]
    s = min(w, h) // 3
    cy, cx = h // 2, w // 2
    crop = (slice(cy - s // 2, cy + s // 2), slice(cx - s // 2, cx + s // 2))
    for k in range(2):
        film_cov = 255 - films[k][..., 0]
        mx, my = shift(signals[k][crop], film_cov[crop])
        line = f"plate {k + 1}: composite vs film shift {mx:+.0f}, {my:+.0f} px = {mx / px_per_mm:+.2f}, {my / px_per_mm:+.2f} mm"
        if a.dx and a.dy:
            ex, ey = a.dx[k] * px_per_mm, a.dy[k] * px_per_mm
            good = abs(mx - ex) <= 2 and abs(my - ey) <= 2
            line += f" (expected {ex:+.1f}, {ey:+.1f} px) {'OK' if good else 'MISMATCH'}"
            ok &= good
        print(line)
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
