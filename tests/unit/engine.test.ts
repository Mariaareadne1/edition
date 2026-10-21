import { describe, expect, it } from 'vitest'
import { separate } from '../../src/engine/separations'
import { dotArea, dotRadius } from '../../src/engine/halftone'
import { rasterizePlate, renderSheet, sheetLayout, valueNoise, type SheetLayout } from '../../src/engine/render'
import { hexToLinear, linearToOklab, toLinear, toSrgb } from '../../src/engine/color'
import { DEFAULT_SETTINGS } from '../../src/state/document'
import { paintSample } from '../../src/engine/sample'
import type { PrintSettings } from '../../src/engine/types'
import { blockParity, grayRamp, mean, quadrants, solid } from './fixtures'

const inks = DEFAULT_SETTINGS.inks
const sep = { contrast: 1, density: 0, accent: 1.2, balance: 0.65 }
const PAPER = '#ffffff'

describe('color', () => {
  it('sRGB ↔ linear round-trips', () => {
    for (let i = 0; i <= 255; i += 15) expect(toSrgb(toLinear(i / 255))).toBeCloseTo(i / 255, 6)
  })
  it('OKLab lightness of white is 1 and black is 0', () => {
    expect(linearToOklab(1, 1, 1)[0]).toBeCloseTo(1, 4)
    expect(linearToOklab(0, 0, 0)[0]).toBeCloseTo(0, 6)
  })
})

describe('separate (E1)', () => {
  it('pure white paper-colour pixels need no ink; black needs full key', () => {
    const white = separate(solid(4, 4, [255, 255, 255, 255]), 4, 4, PAPER, inks, sep)
    expect(Math.max(...white.key, ...white.accent)).toBe(0)
    const black = separate(solid(4, 4, [0, 0, 0, 255]), 4, 4, PAPER, inks, sep)
    for (const v of black.key) expect(v).toBeCloseTo(1, 5)
    expect(Math.max(...black.accent)).toBe(0)
  })

  it('key coverage rises monotonically along a grey ramp and stays in [0, 1]', () => {
    const w = 64
    const m = separate(grayRamp(w, 2), w, 2, PAPER, inks, { ...sep, contrast: 1.4 })
    for (let x = 1; x < w; x++) expect(m.key[x]!).toBeGreaterThanOrEqual(m.key[x - 1]! - 1e-6)
    for (const v of [...m.key, ...m.accent]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('the accent plate picks up colours near the accent ink hue, not opposite ones', () => {
    const m = separate(quadrants(8, 8), 8, 8, PAPER, inks, sep)
    const at = (x: number, y: number) => m.accent[y * 8 + x]!
    const red = at(1, 1)
    const green = at(6, 1)
    const blue = at(1, 6)
    const coral = at(6, 6)
    expect(coral).toBeGreaterThan(0.5)
    expect(red).toBeGreaterThan(0.3)
    expect(green).toBe(0)
    expect(blue).toBe(0)
  })

  it('transparent pixels composite over the paper and print nothing', () => {
    const m = separate(solid(4, 4, [0, 0, 0, 0]), 4, 4, '#f4efe4', inks, sep)
    expect(Math.max(...m.key, ...m.accent)).toBeCloseTo(0, 6)
    const half = separate(solid(4, 4, [0, 0, 0, 128]), 4, 4, PAPER, inks, sep)
    expect(half.key[0]!).toBeGreaterThan(0.2)
    expect(half.key[0]!).toBeLessThan(0.9)
  })

  it('a neutral accent ink yields an empty accent plate', () => {
    const grey: typeof inks = [inks[0], { ...inks[1], color: '#808080' }]
    const m = separate(quadrants(8, 8), 8, 8, PAPER, grey, sep)
    expect(Math.max(...m.accent)).toBe(0)
  })

  it('is deterministic', () => {
    const src = paintSample(40, 50)
    expect(separate(src, 40, 50, PAPER, inks, sep)).toEqual(separate(src, 40, 50, PAPER, inks, sep))
  })

  it('rejects mismatched buffers', () => {
    expect(() => separate(new Uint8ClampedArray(10), 4, 4, PAPER, inks, sep)).toThrow(/does not match/)
  })
})

describe('halftone dot (E2)', () => {
  it('dot area is exact and monotonic; the inverse round-trips', () => {
    let prev = -1
    for (let c = 0; c <= 1.0001; c += 0.01) {
      const r = dotRadius(c)
      expect(r).toBeGreaterThan(prev - 1e-9)
      prev = r
      expect(dotArea(r)).toBeCloseTo(Math.min(1, c), 3)
    }
    expect(dotArea(0.5)).toBeCloseTo(Math.PI / 4, 9)
    expect(dotArea(Math.SQRT1_2)).toBe(1)
  })
})

function uniformPlate(coverage: number, layout: SheetLayout, angle = 15, ruling = 60, reg = { dx: 0, dy: 0, rotate: 0 }) {
  const map = new Float32Array(4).fill(coverage)
  const out = new Float32Array(layout.width * layout.height)
  rasterizePlate({ layout, map, mapWidth: 2, mapHeight: 2, ruling, angleDeg: angle, registration: reg, marks: false, rowStart: 0, rowEnd: layout.height }, out)
  return out
}

/** Mean of a plate over the central part of the image area (away from edges). */
function centralMean(a: Float32Array, layout: SheetLayout) {
  const { width, scale, image } = layout
  const x0 = Math.round((image.x + image.w * 0.25) * scale)
  const x1 = Math.round((image.x + image.w * 0.75) * scale)
  const y0 = Math.round((image.y + image.h * 0.25) * scale)
  const y1 = Math.round((image.y + image.h * 0.75) * scale)
  let s = 0
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) (s += a[y * width + x]!), n++
  return s / n
}

describe('plate rasterisation (E2)', () => {
  const layout = sheetLayout(1, 1, 600, 0)

  it('inked area equals the requested coverage (0 % … 100 %)', () => {
    for (const c of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
      expect(centralMean(uniformPlate(c, layout), layout)).toBeCloseTo(c, 1)
      expect(Math.abs(centralMean(uniformPlate(c, layout), layout) - c)).toBeLessThan(0.02)
    }
  })

  it('stays accurate at small cells thanks to supersampling', () => {
    const small = sheetLayout(1, 1, 300, 0)
    for (const c of [0.1, 0.5, 0.9]) {
      expect(Math.abs(centralMean(uniformPlate(c, small, 15, 120), small) - c)).toBeLessThan(0.03)
    }
  })

  it('a plate offset moves the dot pattern by exactly that many pixels', () => {
    const plain = uniformPlate(0.4, layout)
    const mm = 297 / 600 // one pixel in millimetres at this size
    const moved = uniformPlate(0.4, layout, 15, 60, { dx: 10 * mm, dy: -4 * mm, rotate: 0 })
    const { width } = layout
    let diffShifted = 0
    let diffUnshifted = 0
    for (let y = 100; y < 500; y += 3)
      for (let x = 100; x < 500; x += 3) {
        diffShifted += Math.abs(moved[y * width + x]! - plain[(y + 4) * width + (x - 10)]!)
        diffUnshifted += Math.abs(moved[y * width + x]! - plain[y * width + x]!)
      }
    expect(diffShifted).toBeLessThan(diffUnshifted * 0.02)
  })

  it('screen angle changes the pattern but not the coverage', () => {
    const a = uniformPlate(0.3, layout, 15)
    const b = uniformPlate(0.3, layout, 75)
    expect(centralMean(a, layout)).toBeCloseTo(centralMean(b, layout), 2)
    let differ = 0
    for (let i = 0; i < a.length; i += 7) if (Math.abs(a[i]! - b[i]!) > 0.5) differ++
    expect(differ).toBeGreaterThan(a.length / 7 / 10)
  })
})

describe('composite & export model (E2/E4)', () => {
  const settings: PrintSettings = { ...DEFAULT_SETTINGS, paper: { ...DEFAULT_SETTINGS.paper, grain: 0, inkTexture: 0, marks: false } }
  const src = paintSample(80, 100)
  const maps = separate(src, 80, 100, settings.paper.color, settings.inks, settings.separation)
  const input = { maps, source: src }

  it('margins are bare paper; the image area is inked', () => {
    const layout = sheetLayout(80, 100, 400, 0.1)
    const rgba = renderSheet(input, settings, 'print', layout)
    const [pr, pg, pb] = hexToLinear(settings.paper.color).map((c) => Math.round(toSrgb(c) * 255))
    expect([rgba[0], rgba[1], rgba[2]]).toEqual([pr, pg, pb])
    // Deep water near the bottom of the picture is dark: it must carry ink.
    const px = Math.round((layout.image.x + layout.image.w * 0.5) * layout.scale)
    const py = Math.round((layout.image.y + layout.image.h * 0.95) * layout.scale)
    const i = (py * layout.width + px) * 4
    expect(rgba[i]! + rgba[i + 1]! + rgba[i + 2]!).toBeLessThan((pr! + pg! + pb!) * 0.7)
  })

  it('rendering is deterministic, including seeded grain', () => {
    const grainy = { ...settings, paper: { ...settings.paper, grain: 0.8, inkTexture: 0.6, seed: 42 } }
    const layout = sheetLayout(80, 100, 200, 0.05)
    expect(renderSheet(input, grainy, 'print', layout)).toEqual(renderSheet(input, grainy, 'print', layout))
    const other = { ...grainy, paper: { ...grainy.paper, seed: 43 } }
    expect(renderSheet(input, other, 'print', layout)).not.toEqual(renderSheet(input, grainy, 'print', layout))
  })

  it('grain noise is resolution independent (a field in sheet units)', () => {
    expect(valueNoise(0.3, 0.7, 320, 9)).toBe(valueNoise(0.3, 0.7, 320, 9))
    const v = valueNoise(0.123, 0.456, 320, 9)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(1)
  })

  it('a downsampled high-resolution render matches the preview render', () => {
    const small = sheetLayout(80, 100, 300, 0.06)
    const big = sheetLayout(80, 100, 1200, 0.06)
    const a = renderSheet(input, settings, 'print', small)
    const b = renderSheet(input, settings, 'print', big)
    const { meanDiff, worstDiff } = blockParity(a, small, b, big, 12)
    expect(meanDiff).toBeLessThan(1)
    expect(worstDiff).toBeLessThan(3)
  })

  it('films are registered black-on-white coverage, independent of the misregistration', () => {
    const layout = sheetLayout(80, 100, 300, 0.06)
    const off = { ...settings, registration: [{ dx: 3, dy: 2, rotate: 1 }, { dx: -3, dy: 0, rotate: 0 }] as PrintSettings['registration'] }
    const f1 = renderSheet(input, settings, 'film1', layout)
    expect(renderSheet(input, off, 'film1', layout)).toEqual(f1)
    for (let i = 0; i < f1.length; i += 4) expect(f1[i]).toBe(f1[i + 1])
    expect(mean(Array.from(f1).filter((_, i) => i % 4 === 0))).toBeLessThan(250)
  })

  it('turning an ink off removes it from the print', () => {
    const layout = sheetLayout(80, 100, 200, 0.05)
    const keyOnly = { ...settings, inks: [settings.inks[0], { ...settings.inks[1], enabled: false }] as PrintSettings['inks'] }
    expect(renderSheet(input, keyOnly, 'print', layout)).toEqual(renderSheet(input, settings, 'ink1', layout))
  })
})
