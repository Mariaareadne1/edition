/**
 * Amplitude-modulated halftone with a round ("Euclidean") dot.
 *
 * Each screen cell takes the coverage c sampled at its centre and inks the
 * points within distance R of the centre, where R is chosen so that the inked
 * area of the circle clipped to the unit cell equals c exactly:
 *
 *   area(R) = πR²                                   for R ≤ ½
 *   area(R) = πR² − 4·(R²·acos(½R⁻¹) − ½·√(R² − ¼))  for ½ < R ≤ √½
 *
 * area() is strictly increasing, so dot size is monotonic in darkness and a
 * uniform field of coverage c is inked over exactly a fraction c of the paper
 * (up to anti-aliasing). R is looked up from a precomputed inverse table.
 */

const TABLE_SIZE = 2048
const R_MAX = Math.SQRT1_2

export function dotArea(r: number): number {
  if (r <= 0) return 0
  if (r <= 0.5) return Math.PI * r * r
  if (r >= R_MAX) return 1
  const segment = r * r * Math.acos(0.5 / r) - 0.5 * Math.sqrt(r * r - 0.25)
  return Math.PI * r * r - 4 * segment
}

/** radius for coverage i / (TABLE_SIZE − 1), by bisection on dotArea */
const RADIUS_FOR_COVERAGE = (() => {
  const table = new Float32Array(TABLE_SIZE)
  for (let i = 0; i < TABLE_SIZE; i++) {
    const target = i / (TABLE_SIZE - 1)
    let lo = 0
    let hi = R_MAX
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2
      if (dotArea(mid) < target) lo = mid
      else hi = mid
    }
    table[i] = (lo + hi) / 2
  }
  return table
})()

export function dotRadius(coverage: number): number {
  const c = coverage <= 0 ? 0 : coverage >= 1 ? 1 : coverage
  const f = c * (TABLE_SIZE - 1)
  const i = Math.floor(f)
  if (i >= TABLE_SIZE - 1) return RADIUS_FOR_COVERAGE[TABLE_SIZE - 1]!
  const t = f - i
  return RADIUS_FOR_COVERAGE[i]! * (1 - t) + RADIUS_FOR_COVERAGE[i + 1]! * t
}

/** Supersampling grid size for a given cell size in pixels. */
export function supersampleFor(cellPx: number): number {
  return cellPx < 3 ? 4 : cellPx < 5 ? 3 : cellPx < 8 ? 2 : 1
}
