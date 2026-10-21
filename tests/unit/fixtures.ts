// Code-generated test images. No external assets.
export function solid(w: number, h: number, rgba: [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) out.set(rgba, i * 4)
  return out
}

/** Horizontal grey ramp, white on the left to black on the right. */
export function grayRamp(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round(255 * (1 - x / (w - 1)))
      out.set([v, v, v, 255], (y * w + x) * 4)
    }
  return out
}

/** Four quadrants: red, green, blue, coral. */
export function quadrants(w: number, h: number): Uint8ClampedArray {
  const colors: Array<[number, number, number, number]> = [[220, 40, 40, 255], [40, 170, 60, 255], [40, 60, 200, 255], [244, 102, 74, 255]]
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out.set(colors[(y < h / 2 ? 0 : 2) + (x < w / 2 ? 0 : 1)]!, (y * w + x) * 4)
  return out
}

export function mean(a: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]!
  return s / a.length
}

interface Dims { width: number; height: number; scale: number }

const LIN = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
})

/**
 * Compare two renders of the same sheet at different sizes: average each
 * `block`-pixel tile of the small render and the same sheet region of the
 * large one (mapped by the exact scale ratio), in linear light — light from
 * a halftone mixes linearly — and report mean / worst difference re-encoded
 * to 0–255 sRGB units.
 */
export function blockParity(a: ArrayLike<number>, sa: Dims, b: ArrayLike<number>, sb: Dims, block: number) {
  const r = sb.scale / sa.scale
  const avg = (buf: ArrayLike<number>, w: number, x0: number, y0: number, x1: number, y1: number) => {
    let s = 0
    let n = 0
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4
        s += LIN[buf[i]!]! + LIN[buf[i + 1]!]! + LIN[buf[i + 2]!]!
        n += 3
      }
    const lin = s / n
    return 255 * (lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055)
  }
  let worstDiff = 0
  let total = 0
  let blocks = 0
  for (let by = 0; by + block <= sa.height; by += block)
    for (let bx = 0; bx + block <= sa.width; bx += block) {
      const da = avg(a, sa.width, bx, by, bx + block, by + block)
      const db = avg(b, sb.width, Math.round(bx * r), Math.round(by * r), Math.min(sb.width, Math.round((bx + block) * r)), Math.min(sb.height, Math.round((by + block) * r)))
      const d = Math.abs(da - db)
      worstDiff = Math.max(worstDiff, d)
      total += d
      blocks++
    }
  return { meanDiff: total / blocks, worstDiff }
}
