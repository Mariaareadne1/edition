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

/** Flat swatches: paper white, cobalt, accent coral, its complement (teal), mid grey, black. */
export function swatches(w: number, h: number): Uint8ClampedArray {
  const colors: Array<[number, number, number, number]> = [
    [255, 255, 255, 255], [31, 58, 147, 255], [244, 102, 74, 255], [40, 170, 180, 255], [128, 128, 128, 255], [0, 0, 0, 255],
  ]
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out.set(colors[Math.min(5, Math.floor((x / w) * 6))]!, (y * w + x) * 4)
  return out
}

/** Hard diagonal black/white stripes — tests edge rendering and screen angles. */
export function diagonalEdges(w: number, h: number, period = 24): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.floor((x + y) / period) % 2 === 0 ? 0 : 255
      out.set([v, v, v, 255], (y * w + x) * 4)
    }
  return out
}

/** Coral disc fading to fully transparent at its rim, on a transparent field. */
export function transparentDisc(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  const r = Math.min(w, h) * 0.45
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - w / 2, y - h / 2) / r
      const a = d >= 1 ? 0 : Math.round(255 * (1 - d))
      out.set([244, 102, 74, a], (y * w + x) * 4)
    }
  return out
}

/**
 * A detailed "photograph": a lit sphere on a striped cloth under a graded
 * sky, with deterministic texture noise — continuous tone, colour, highlights
 * and fine detail in one frame.
 */
export function detailedScene(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  let s = 12345
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      let r: number, g: number, b: number
      if (v < 0.55) {
        r = 70 + 150 * v; g = 110 + 110 * v; b = 190 - 40 * v
      } else {
        const stripe = Math.sin((u * 18 + v * 4) * Math.PI) > 0
        r = stripe ? 200 : 90; g = stripe ? 70 : 60; b = stripe ? 50 : 70
        r *= 1.2 - v * 0.5; g *= 1.2 - v * 0.5; b *= 1.2 - v * 0.5
      }
      const dx = (u - 0.5) / 0.22, dy = (v - 0.5) / (0.22 * w / h)
      const d2 = dx * dx + dy * dy
      if (d2 < 1) {
        const nz = Math.sqrt(1 - d2)
        const lit = Math.max(0, -0.5 * dx - 0.6 * dy + 0.62 * nz)
        const spec = Math.pow(lit, 24)
        r = 30 + 200 * lit + 255 * spec; g = 50 + 110 * lit + 255 * spec; b = 60 + 60 * lit + 255 * spec
      }
      const n = (rnd() - 0.5) * 18
      out.set([r + n, g + n, b + n, 255], (y * w + x) * 4)
    }
  return out
}
