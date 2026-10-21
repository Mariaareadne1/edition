/**
 * "Harbour, dusk" — Edition's built-in sample, painted procedurally so the
 * repository ships no photograph of uncertain provenance. Pure and
 * resolution-independent: every feature is defined in normalised coordinates
 * with analytic anti-aliasing, so any size renders the same picture.
 */

type RGB = [number, number, number]

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

const SKY_TOP = hex('#25315e')
const SKY_MID = hex('#7a6f9e')
const SKY_WARM = hex('#f19a74')
const SKY_HORIZON = hex('#f8dcb8')
const SUN = hex('#f05a3c')
const HILL_FAR = hex('#8a87a8')
const HILL_NEAR = hex('#46507e')
const SEA_TOP = hex('#5c6491')
const SEA_DEEP = hex('#1e2448')
const GLINT = hex('#f7b48a')
const INK = hex('#141833')

const HORIZON = 0.6

function hillFar(x: number) {
  return 0.52 + 0.035 * Math.sin(x * 7.1 + 0.6) + 0.02 * Math.sin(x * 17.3 + 2.1) + 0.008 * Math.sin(x * 41 + 1)
}
function hillNear(x: number) {
  return 0.565 + 0.03 * Math.sin(x * 4.3 + 3.2) + 0.014 * Math.sin(x * 23.7) - 0.05 * smooth(0.55, 1, x)
}

/** Paint the sample at width × height into a new RGBA buffer. */
export function paintSample(width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  const aa = 1.5 / Math.min(width, height)
  const aspect = width / height
  for (let py = 0; py < height; py++) {
    const y = (py + 0.5) / height
    for (let px = 0; px < width; px++) {
      const x = (px + 0.5) / width
      let c: RGB

      // Sky: cool overhead, warming toward the horizon.
      const s = y / HORIZON
      c = s < 0.45 ? mix(SKY_TOP, SKY_MID, s / 0.45) : s < 0.8 ? mix(SKY_MID, SKY_WARM, (s - 0.45) / 0.35) : mix(SKY_WARM, SKY_HORIZON, (s - 0.8) / 0.2)

      // Sun with a soft halo.
      const sd = Math.hypot((x - 0.63) * aspect, y - 0.45)
      c = mix(c, SKY_HORIZON, 0.35 * Math.exp(-sd * sd * 60))
      c = mix(c, SUN, 1 - smooth(0.085 - aa, 0.085 + aa, sd))

      // Two ranges of hills.
      c = mix(c, HILL_FAR, smooth(-aa, aa, y - hillFar(x)))
      c = mix(c, HILL_NEAR, smooth(-aa, aa, y - hillNear(x)))

      // Sea, with a broken column of sunlight.
      if (y > HORIZON - aa) {
        const d = (y - HORIZON) / (1 - HORIZON)
        let sea = mix(SEA_TOP, SEA_DEEP, Math.pow(d, 0.7))
        const ripple = Math.sin(y * 260 + Math.sin(x * 40) * 2) * 0.5 + 0.5
        const column = Math.exp(-Math.pow((x - 0.63) / (0.03 + d * 0.12), 2))
        const glint = column * smooth(0.55, 0.9, ripple) * (1 - d * 0.6)
        sea = mix(sea, GLINT, Math.min(1, glint * 1.2))
        sea = mix(sea, SEA_DEEP, 0.12 * (1 - ripple) * d)
        c = mix(c, sea, smooth(-aa, aa, y - HORIZON))
      }

      // A small sailboat.
      const bx = (x - 0.3) * aspect
      const by = y - 0.7
      const hull = Math.max(Math.abs(bx) - 0.075 + by * 0.6, Math.abs(by - 0.012) - 0.012)
      const mast = Math.max(Math.abs(bx + 0.005) - 0.002, Math.abs(by + 0.075) - 0.075)
      const sail = Math.max(-bx + 0.0, bx - 0.065 * (1 + (by + 0.005) / 0.14), -by - 0.14, by + 0.005)
      c = mix(c, INK, 1 - smooth(-aa, aa, Math.min(hull, mast)))
      c = mix(c, SKY_HORIZON, 1 - smooth(-aa, aa, sail))
      // Its reflection, broken by ripples.
      if (by > 0.024 && by < 0.09 && Math.abs(bx) < 0.07 - (by - 0.024) * 0.5) {
        const r = Math.sin(y * 300) * 0.5 + 0.5
        c = mix(c, INK, 0.35 * smooth(0.4, 0.7, r) * (1 - (by - 0.024) / 0.066))
      }

      // Birds.
      for (const [bxc, byc, size] of [[0.44, 0.22, 0.016], [0.48, 0.25, 0.012], [0.41, 0.27, 0.01]] as const) {
        const dx = (x - bxc) * aspect
        const dy = y - byc
        const wing = Math.abs(dy + Math.abs(dx) * 0.55 - Math.abs(dx) * Math.abs(dx) * 18) - size * 0.12
        if (Math.abs(dx) < size) c = mix(c, INK, 1 - smooth(-aa, aa, wing))
      }

      const o = (py * width + px) * 4
      out[o] = c[0]
      out[o + 1] = c[1]
      out[o + 2] = c[2]
      out[o + 3] = 255
    }
  }
  return out
}

export const SAMPLE_ASPECT = 4 / 5
