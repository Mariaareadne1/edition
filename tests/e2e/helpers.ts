import { expect, type Page } from '@playwright/test'
import { PNG } from 'pngjs'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const TMP = mkdtempSync(join(tmpdir(), 'edition-e2e-'))

export function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

export async function freshStudio(page: Page) {
  await page.goto('/')
  await page.evaluate(() => new Promise<void>((r) => {
    const req = indexedDB.deleteDatabase('edition')
    req.onsuccess = req.onerror = req.onblocked = () => r()
  }))
  await page.reload()
  await waitForProof(page)
}

export async function waitForProof(page: Page, timeout = 45_000) {
  await expect(page.getByTestId('proof-status')).toContainText('proofed in', { timeout })
}

/** Wait until the proof stops changing (no newer render pending). */
export async function settledProof(page: Page) {
  await waitForProof(page)
  await page.waitForTimeout(250)
  await waitForProof(page)
}

/** Summary of the proof canvas computed in the page (no megabyte transfers). */
export function proofStats(page: Page) {
  return page.getByTestId('proof').evaluate((c: HTMLCanvasElement) => {
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    let h = 2166136261
    let sum = 0
    let sq = 0
    for (let i = 0; i < data.length; i += 4) {
      const l = (data[i]! + data[i + 1]! + data[i + 2]!) / 3
      sum += l
      sq += l * l
      h = Math.imul(h ^ data[i]!, 16777619) ^ data[i + 2]!
    }
    const n = data.length / 4
    return { width, height, mean: sum / n, std: Math.sqrt(sq / n - (sum / n) ** 2), hash: h >>> 0 }
  })
}

const LIN = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
})
const enc = (lin: number) => 255 * (lin <= 0.0031308 ? lin * 12.92 : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055)

/** Block means (linear light, re-encoded) of the proof canvas, computed in the page. */
export function proofBlocks(page: Page, block: number) {
  return page.getByTestId('proof').evaluate((c: HTMLCanvasElement, block) => {
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    const lin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
    const out: number[] = []
    for (let by = 0; by + block <= height; by += block)
      for (let bx = 0; bx + block <= width; bx += block) {
        let s = 0
        for (let y = by; y < by + block; y++)
          for (let x = bx; x < bx + block; x++) {
            const i = (y * width + x) * 4
            s += lin(data[i]!) + lin(data[i + 1]!) + lin(data[i + 2]!)
          }
        const m = s / (block * block * 3)
        out.push(255 * (m <= 0.0031308 ? m * 12.92 : 1.055 * Math.pow(m, 1 / 2.4) - 0.055))
      }
    return { width, height, blocks: out }
  }, block)
}

/** The same block means for a decoded PNG at a larger scale, mapped onto the preview's blocks. */
export function pngBlocks(png: PNG, preview: { width: number; height: number }, block: number) {
  const r = Math.max(png.width, png.height) / Math.max(preview.width, preview.height)
  const out: number[] = []
  for (let by = 0; by + block <= preview.height; by += block)
    for (let bx = 0; bx + block <= preview.width; bx += block) {
      const x0 = Math.round(bx * r), x1 = Math.min(png.width, Math.round((bx + block) * r))
      const y0 = Math.round(by * r), y1 = Math.min(png.height, Math.round((by + block) * r))
      let s = 0
      let n = 0
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * png.width + x) * 4
          s += LIN[png.data[i]!]! + LIN[png.data[i + 1]!]! + LIN[png.data[i + 2]!]!
          n += 3
        }
      out.push(enc(s / n))
    }
  return out
}

/** A small code-generated "photograph": sky gradient, warm sun, dark ground. */
export function writeTestPhoto(name: string, width = 600, height = 400): string {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const t = y / height
      let [r, g, b] = [40 + 180 * t, 60 + 120 * t, 140 + 60 * t]
      if (Math.hypot(x - width * 0.7, y - height * 0.35) < height * 0.15) [r, g, b] = [240, 100, 70]
      if (y > height * 0.7) [r, g, b] = [25, 30, 50]
      png.data[i] = r
      png.data[i + 1] = g
      png.data[i + 2] = b
      png.data[i + 3] = 255
    }
  const path = join(TMP, name)
  writeFileSync(path, PNG.sync.write(png))
  return path
}

export function readPng(path: string): PNG {
  return PNG.sync.read(readFileSync(path))
}
