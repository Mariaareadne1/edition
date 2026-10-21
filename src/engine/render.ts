/**
 * The print renderer. One function produces every image Edition shows or
 * exports — preview, full-resolution composite, and plate films — so they can
 * only differ by resolution.
 *
 * Coordinates are "sheet units": 1 = the sheet's long edge. Everything that
 * has a size (screen cells, offsets, grain, marks, margins) is defined in sheet
 * units, so a render at 900 px and one at 3508 px describe the same print.
 *
 * Per output pixel, for each ink:
 *   1. map the pixel into that plate's frame (inverse of its offset + rotation)
 *      — misregistration moves the generated dots, never a screenshot;
 *   2. find the screen cell at the plate's angle and ruling, sample the
 *      coverage map at the cell centre, and ink the exact-area round dot;
 *   3. anti-alias with an analytic edge ramp, supersampled for small cells.
 * Then composite on paper with a multiplicative transmission model in linear
 * light:  out = paper · Π_k (1 − α_k · opacity_k · (1 − ink_k))
 * which approximates transparent inks overprinting; it is not a spectral or
 * ICC proof.
 */
import { hexToLinear, linearToSrgb8, SRGB_TO_LINEAR } from './color'
import { dotRadius, supersampleFor } from './halftone'
import { sampleMap, type CoverageMaps } from './separations'
import { SHEET_LONG_EDGE_MM, type PrintSettings, type Registration } from './types'

export interface SheetLayout {
  width: number
  height: number
  /** pixels per sheet unit (= long edge in px) */
  scale: number
  /** image rectangle in sheet units */
  image: { x: number; y: number; w: number; h: number }
  /** sheet size in sheet units */
  sheet: { w: number; h: number }
}

export const MAX_LONG_EDGE = 4200

export function sheetLayout(sourceWidth: number, sourceHeight: number, longEdge: number, margin: number): SheetLayout {
  const L = Math.max(16, Math.min(MAX_LONG_EDGE, Math.round(longEdge)))
  const m = Math.max(0, Math.min(0.2, margin))
  const aspect = sourceWidth / sourceHeight
  // Long edge of the *sheet* is 1; the image fills it minus margins.
  let iw: number
  let ih: number
  if (aspect >= 1) {
    iw = 1 - 2 * m
    ih = iw / aspect
  } else {
    ih = 1 - 2 * m
    iw = ih * aspect
  }
  const sw = aspect >= 1 ? 1 : iw + 2 * m
  const sh = aspect >= 1 ? ih + 2 * m : 1
  return {
    width: Math.max(1, Math.round(sw * L)),
    height: Math.max(1, Math.round(sh * L)),
    scale: L,
    image: { x: m, y: m, w: iw, h: ih },
    sheet: { w: sw, h: sh },
  }
}

// ── deterministic grain ────────────────────────────────────────────────────

function hash(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1) at `freq` cells per sheet unit. */
export function valueNoise(x: number, y: number, freq: number, seed: number): number {
  const fx = x * freq
  const fy = y * freq
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const a = hash(ix, iy, seed)
  const b = hash(ix + 1, iy, seed)
  const c = hash(ix, iy + 1, seed)
  const d = hash(ix + 1, iy + 1, seed)
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy
}

const PAPER_TOOTH_FREQ = 320
const INK_MOTTLE_FREQ = [90, 410] as const

// ── registration marks ─────────────────────────────────────────────────────

interface Mark {
  x: number
  y: number
}

function markPositions(layout: SheetLayout): Mark[] {
  const { image, sheet } = layout
  const gap = image.x / 2
  return [
    { x: sheet.w / 2, y: gap },
    { x: sheet.w / 2, y: sheet.h - gap },
    { x: gap, y: sheet.h / 2 },
    { x: sheet.w - gap, y: sheet.h / 2 },
  ]
}

/** Signed distance (sheet units) to the nearest registration-mark stroke. */
function markDistance(px: number, py: number, marks: Mark[], size: number): number {
  const stroke = size * 0.07
  let best = Infinity
  for (const m of marks) {
    const dx = px - m.x
    const dy = py - m.y
    if (Math.abs(dx) > size * 1.2 || Math.abs(dy) > size * 1.2) continue
    const ring = Math.abs(Math.hypot(dx, dy) - size * 0.55) - stroke / 2
    const h = Math.abs(dx) <= size ? Math.abs(dy) - stroke / 2 : Infinity
    const v = Math.abs(dy) <= size ? Math.abs(dx) - stroke / 2 : Infinity
    best = Math.min(best, ring, h, v)
  }
  return best
}

// ── plate raster ───────────────────────────────────────────────────────────

export interface PlateRasterOptions {
  layout: SheetLayout
  map: Float32Array
  mapWidth: number
  mapHeight: number
  ruling: number
  angleDeg: number
  registration: Registration
  marks: boolean
  rowStart: number
  rowEnd: number
}

/**
 * Ink coverage α ∈ [0, 1] for each pixel of rows [rowStart, rowEnd), written
 * into `out` indexed relative to rowStart. Pure and deterministic.
 */
export function rasterizePlate(o: PlateRasterOptions, out: Float32Array): void {
  const { layout, map, mapWidth, mapHeight, ruling } = o
  const { width, scale, image, sheet } = layout
  const cellPx = scale / ruling
  const ss = supersampleFor(cellPx)
  const edge = cellPx * ss // AA ramp: one sub-pixel wide
  const angle = (o.angleDeg * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const rot = (-o.registration.rotate * Math.PI) / 180
  const rcos = Math.cos(rot)
  const rsin = Math.sin(rot)
  const cx = sheet.w / 2
  const cy = sheet.h / 2
  const offX = o.registration.dx / SHEET_LONG_EDGE_MM
  const offY = o.registration.dy / SHEET_LONG_EDGE_MM
  const marks = o.marks && image.x > 0.02 ? markPositions(layout) : null
  const markSize = image.x * 0.28
  const inv = 1 / (scale * ss)
  const weight = 1 / (ss * ss)

  let lastU = NaN
  let lastV = NaN
  let lastR = 0

  for (let py = o.rowStart; py < o.rowEnd; py++) {
    for (let px = 0; px < width; px++) {
      let alpha = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          // Sheet point → plate frame (undo the plate's offset and rotation about the sheet centre).
          const qx = (px * ss + sx + 0.5) * inv - cx - offX
          const qy = (py * ss + sy + 0.5) * inv - cy - offY
          const plx = qx * rcos - qy * rsin + cx
          const ply = qx * rsin + qy * rcos + cy
          // Screen cell at the plate's angle.
          const U = (plx * cos + ply * sin) * ruling
          const V = (-plx * sin + ply * cos) * ruling
          const iu = Math.floor(U)
          const iv = Math.floor(V)
          if (iu !== lastU || iv !== lastV) {
            const cu = (iu + 0.5) / ruling
            const cv = (iv + 0.5) / ruling
            const ccx = cu * cos - cv * sin
            const ccy = cu * sin + cv * cos
            const c = sampleMap(map, mapWidth, mapHeight, (ccx - image.x) / image.w, (ccy - image.y) / image.h)
            lastR = c > 0 ? dotRadius(c) : -1
            lastU = iu
            lastV = iv
          }
          let a = 0
          if (lastR > 0) {
            const fu = U - iu - 0.5
            const fv = V - iv - 0.5
            const d = Math.sqrt(fu * fu + fv * fv)
            a = 0.5 - (d - lastR) * edge
            a = a < 0 ? 0 : a > 1 ? 1 : a
          }
          if (marks) {
            const md = markDistance(plx, ply, marks, markSize) * scale * ss
            const m = 0.5 - md
            if (m > a) a = m > 1 ? 1 : m
          }
          alpha += a
        }
      }
      out[(py - o.rowStart) * width + px] = alpha * weight
    }
  }
}

// ── composite ──────────────────────────────────────────────────────────────

export type RenderMode = 'print' | 'ink1' | 'ink2' | 'film1' | 'film2' | 'source'

export interface RenderInput {
  maps: CoverageMaps
  /** source pixels at the coverage maps' resolution (for the 'source' view) */
  source: Uint8ClampedArray
}

export interface RenderRequest {
  settings: PrintSettings
  mode: RenderMode
  layout: SheetLayout
  rowStart: number
  rowEnd: number
  /** first sheet row stored in the output buffer (default 0 = full-sheet buffer) */
  outRowStart?: number
}

const NO_REGISTRATION: Registration = { dx: 0, dy: 0, rotate: 0 }

/**
 * Render rows [rowStart, rowEnd) of the sheet into an RGBA buffer of the full
 * sheet. `scratch` buffers need (rowEnd − rowStart) × width entries.
 */
export function renderRows(input: RenderInput, req: RenderRequest, rgba: Uint8ClampedArray, scratch: [Float32Array, Float32Array]): void {
  const { settings, mode, layout, rowStart, rowEnd } = req
  const { width, scale } = layout
  const { maps } = input
  const base = (req.outRowStart ?? 0) * width

  if (mode === 'source') return renderSource(input, layout, settings.paper.color, rowStart, rowEnd, rgba, base)

  const film = mode === 'film1' || mode === 'film2'
  const want = [
    mode === 'film1' || mode === 'ink1' || (mode === 'print' && settings.inks[0].enabled),
    mode === 'film2' || mode === 'ink2' || (mode === 'print' && settings.inks[1].enabled),
  ]
  const plateMaps = [maps.key, maps.accent]
  for (let k = 0; k < 2; k++) {
    if (!want[k]) continue
    rasterizePlate(
      {
        layout,
        map: plateMaps[k]!,
        mapWidth: maps.width,
        mapHeight: maps.height,
        ruling: settings.screen.ruling,
        angleDeg: settings.screen.angles[k]!,
        registration: film ? NO_REGISTRATION : settings.registration[k]!,
        marks: settings.paper.marks,
        rowStart,
        rowEnd,
      },
      scratch[k]!,
    )
  }

  if (film) {
    const a = scratch[mode === 'film1' ? 0 : 1]!
    for (let py = rowStart; py < rowEnd; py++) {
      for (let px = 0; px < width; px++) {
        const v = Math.round((1 - a[(py - rowStart) * width + px]!) * 255)
        const o = (py * width + px - base) * 4
        rgba[o] = rgba[o + 1] = rgba[o + 2] = v
        rgba[o + 3] = 255
      }
    }
    return
  }

  const paper = hexToLinear(settings.paper.color)
  const inks = settings.inks.map((ink) => ({ rgb: hexToLinear(ink.color), opacity: ink.opacity }))
  const { grain, inkTexture, seed } = settings.paper
  const toothAmp = grain * 0.07
  const mottleAmp = inkTexture * 0.45

  for (let py = rowStart; py < rowEnd; py++) {
    const sy = (py + 0.5) / scale
    for (let px = 0; px < width; px++) {
      const sx = (px + 0.5) / scale
      const i = py * width + px - base
      const j = (py - rowStart) * width + px
      let r = paper[0]
      let g = paper[1]
      let b = paper[2]
      if (toothAmp > 0) {
        const t = 1 + toothAmp * (valueNoise(sx, sy, PAPER_TOOTH_FREQ, seed) * 2 - 1)
        r *= t
        g *= t
        b *= t
      }
      let mottle = 1
      if (mottleAmp > 0) {
        const n = 0.65 * valueNoise(sx, sy, INK_MOTTLE_FREQ[0], seed + 7) + 0.35 * valueNoise(sx, sy, INK_MOTTLE_FREQ[1], seed + 13)
        mottle = 1 - mottleAmp * n
      }
      for (let k = 0; k < 2; k++) {
        if (!want[k]) continue
        const a = scratch[k]![j]! * inks[k]!.opacity * mottle
        if (a <= 0) continue
        const ink = inks[k]!.rgb
        r *= 1 - a * (1 - ink[0])
        g *= 1 - a * (1 - ink[1])
        b *= 1 - a * (1 - ink[2])
      }
      const o = i * 4
      rgba[o] = linearToSrgb8(r)
      rgba[o + 1] = linearToSrgb8(g)
      rgba[o + 2] = linearToSrgb8(b)
      rgba[o + 3] = 255
    }
  }
}

function renderSource(input: RenderInput, layout: SheetLayout, paperHex: string, rowStart: number, rowEnd: number, rgba: Uint8ClampedArray, base: number) {
  const { width, scale, image } = layout
  const { maps, source } = input
  const paper = hexToLinear(paperHex).map(linearToSrgb8)
  for (let py = rowStart; py < rowEnd; py++) {
    for (let px = 0; px < width; px++) {
      const u = ((px + 0.5) / scale - image.x) / image.w
      const v = ((py + 0.5) / scale - image.y) / image.h
      const o = (py * width + px - base) * 4
      if (u < 0 || v < 0 || u >= 1 || v >= 1) {
        rgba[o] = paper[0]!
        rgba[o + 1] = paper[1]!
        rgba[o + 2] = paper[2]!
      } else {
        const si = (Math.floor(v * maps.height) * maps.width + Math.floor(u * maps.width)) * 4
        const a = source[si + 3]! / 255
        for (let c = 0; c < 3; c++) {
          const lin = SRGB_TO_LINEAR[source[si + c]!]! * a + SRGB_TO_LINEAR[paper[c]!]! * (1 - a)
          rgba[o + c] = linearToSrgb8(lin)
        }
      }
      rgba[o + 3] = 255
    }
  }
}

export const STRIP_ROWS = 64

export function createScratch(width: number, rows = STRIP_ROWS): [Float32Array, Float32Array] {
  return [new Float32Array(width * rows), new Float32Array(width * rows)]
}

/** Convenience: render a whole sheet synchronously, in strips (tests, export). */
export function renderSheet(input: RenderInput, settings: PrintSettings, mode: RenderMode, layout: SheetLayout): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(layout.width * layout.height * 4)
  const scratch = createScratch(layout.width)
  for (let y = 0; y < layout.height; y += STRIP_ROWS) {
    renderRows(input, { settings, mode, layout, rowStart: y, rowEnd: Math.min(layout.height, y + STRIP_ROWS) }, rgba, scratch)
  }
  return rgba
}
