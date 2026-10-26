/**
 * Golden outputs: the five redesign fixtures rendered through the real engine
 * in every output mode. The hashes were recorded on the pre-redesign engine
 * (commit 2b1f395) and must not change because of UI work — a failure here
 * means printed pixels changed. Regenerate deliberately with
 * UPDATE_GOLDEN=1 pnpm test, and say why in the commit.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { separate } from '../../src/engine/separations'
import { renderSheet, sheetLayout, type RenderMode } from '../../src/engine/render'
import { DEFAULT_SETTINGS } from '../../src/state/document'
import { detailedScene, diagonalEdges, grayRamp, swatches, transparentDisc } from './fixtures'

const FIXTURES = {
  'gray-ramp': { w: 240, h: 160, paint: grayRamp },
  swatches: { w: 240, h: 160, paint: swatches },
  'diagonal-edges': { w: 200, h: 200, paint: diagonalEdges },
  'transparent-disc': { w: 200, h: 240, paint: transparentDisc },
  'detailed-scene': { w: 320, h: 400, paint: detailedScene },
} as const

const MODES: RenderMode[] = ['print', 'film1', 'film2', 'source']
const LONG_EDGE = 600
const GOLDEN = new URL('./golden.json', import.meta.url)

function fnv(data: Uint8ClampedArray): string {
  let h = 2166136261
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i]!, 16777619)
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Ink coverage of a film: fraction of the sheet's light that is blocked. */
function coverage(film: Uint8ClampedArray): number {
  let s = 0
  for (let i = 0; i < film.length; i += 4) s += 1 - film[i]! / 255
  return Math.round((s / (film.length / 4)) * 1e4) / 1e4
}

function renderAll() {
  const out: Record<string, { width: number; height: number; hashes: Record<string, string>; coverage: [number, number] }> = {}
  for (const [name, f] of Object.entries(FIXTURES)) {
    const src = f.paint(f.w, f.h)
    const s = DEFAULT_SETTINGS
    const maps = separate(src, f.w, f.h, s.paper.color, s.inks, s.separation)
    const layout = sheetLayout(f.w, f.h, LONG_EDGE, s.paper.margin)
    const hashes: Record<string, string> = {}
    const films: Uint8ClampedArray[] = []
    for (const mode of MODES) {
      const px = renderSheet({ maps, source: src }, s, mode, layout)
      hashes[mode] = fnv(px)
      if (mode === 'film1' || mode === 'film2') films.push(px)
    }
    out[name] = { width: layout.width, height: layout.height, hashes, coverage: [coverage(films[0]!), coverage(films[1]!)] }
  }
  return out
}

describe('golden fixture outputs (engine must not change with the UI)', () => {
  it('every fixture renders the recorded pixels in every mode', () => {
    const now = renderAll()
    if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, JSON.stringify(now, null, 2) + '\n')
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
    expect(now).toEqual(golden)
  }, 60_000)
})
