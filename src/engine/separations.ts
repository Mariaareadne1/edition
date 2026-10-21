/**
 * Separation: source pixels → two continuous coverage maps in [0, 1].
 *
 *   Key plate (ink 1) carries tone. Tone is darkness relative to the paper:
 *     T  = clamp((L_paper − L) / L_paper)            L = OKLab lightness
 *     T′ = clamp(0.5 + (T − 0.5)·contrast + density)
 *   Accent plate (ink 2) carries colour that leans toward ink 2's hue,
 *   measured relative to the paper's own tint (so a cream sheet isn't "coral"):
 *     ab = (a − a_paper, b − b_paper),  C = |ab|
 *     A  = clamp(C / 0.16) · max(0, cos∠(ab, hue₂))²
 *     c₂ = clamp(accent · A)
 *   Where the accent plate prints, the key plate gives way so the accent reads
 *   as colour rather than mud:
 *     c₁ = T′ · (1 − balance · c₂)
 *
 * Two inks cannot reconstruct arbitrary RGB; this is an interpretive mapping,
 * deliberately simple, deterministic and documented — not a colour-accurate
 * separation. A neutral (grey/black) accent ink has no hue, so its plate is empty.
 */
import { hexToLinear, hueDirection, linearToOklab, SRGB_TO_LINEAR } from './color'
import type { Ink, Separation } from './types'

export interface CoverageMaps {
  width: number
  height: number
  key: Float32Array
  accent: Float32Array
}

const CHROMA_REFERENCE = 0.16

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export function separate(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  paperHex: string,
  inks: [Ink, Ink],
  sep: Separation,
): CoverageMaps {
  if (rgba.length !== width * height * 4) throw new Error('separate: pixel buffer does not match dimensions')
  const n = width * height
  const key = new Float32Array(n)
  const accent = new Float32Array(n)
  const [pr, pg, pb] = hexToLinear(paperHex)
  const [paperLab, paperA, paperB] = linearToOklab(pr, pg, pb)
  const paperL = Math.max(0.05, paperLab)
  const [ha, hb] = hueDirection(inks[1].color)
  const hasHue = ha !== 0 || hb !== 0

  for (let i = 0; i < n; i++) {
    const o = i * 4
    const alpha = rgba[o + 3]! / 255
    // Composite over the paper (in linear light) before analysis.
    const r = SRGB_TO_LINEAR[rgba[o]!]! * alpha + pr * (1 - alpha)
    const g = SRGB_TO_LINEAR[rgba[o + 1]!]! * alpha + pg * (1 - alpha)
    const b = SRGB_TO_LINEAR[rgba[o + 2]!]! * alpha + pb * (1 - alpha)
    const [L, a, bb] = linearToOklab(r, g, b)
    const A = a - paperA
    const B = bb - paperB

    const tone = clamp01((paperL - L) / paperL)
    const shaped = clamp01(0.5 + (tone - 0.5) * sep.contrast + sep.density)

    let c2 = 0
    if (hasHue) {
      const chroma = Math.hypot(A, B)
      if (chroma > 1e-5) {
        const align = Math.max(0, (A * ha + B * hb) / chroma)
        c2 = clamp01(sep.accent * clamp01(chroma / CHROMA_REFERENCE) * align * align)
      }
    }
    accent[i] = c2
    key[i] = shaped * (1 - sep.balance * c2)
  }
  return { width, height, key, accent }
}

/** Bilinear sample of a coverage map at normalised image coords (0–1); 0 outside. */
export function sampleMap(map: Float32Array, width: number, height: number, u: number, v: number): number {
  if (u < 0 || v < 0 || u > 1 || v > 1) return 0
  const x = u * width - 0.5
  const y = v * height - 0.5
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)))
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = Math.max(0, Math.min(1, x - x0))
  const fy = Math.max(0, Math.min(1, y - y0))
  const a = map[y0 * width + x0]!
  const b = map[y0 * width + x1]!
  const c = map[y1 * width + x0]!
  const d = map[y1 * width + x1]!
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}
