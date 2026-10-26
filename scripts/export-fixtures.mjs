// Imports each code-generated fixture into the running studio (pnpm dev) through
// the file input, exports print + both films at A4 / 300 dpi, and saves them to
// artifacts/exports/<fixture>/ for scripts/inspect_exports.py.
//   node --experimental-strip-types scripts/export-fixtures.mjs
import { chromium } from '@playwright/test'
import { PNG } from 'pngjs'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { detailedScene, diagonalEdges, grayRamp, swatches, transparentDisc } from '../tests/unit/fixtures.ts'

const APP = process.env.EDITION_URL ?? 'http://localhost:5411/'
const OUT = new URL('../artifacts/exports/', import.meta.url).pathname
const FIXTURES = {
  'gray-ramp': [1200, 800, grayRamp],
  swatches: [1200, 800, swatches],
  'diagonal-edges': [1000, 1000, diagonalEdges],
  'transparent-disc': [1000, 1200, transparentDisc],
  'detailed-scene': [1280, 1600, detailedScene],
}

const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const summary = []
for (const [name, [w, h, paint]] of Object.entries(FIXTURES)) {
  const dir = `${OUT}${name}/`
  mkdirSync(dir, { recursive: true })
  const png = new PNG({ width: w, height: h })
  png.data.set(paint(w, h))
  const src = `${dir}source.png`
  writeFileSync(src, PNG.sync.write(png))

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  const p = await ctx.newPage()
  await p.goto(APP)
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('edition'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
  await p.reload()
  await p.getByTestId('image-input').setInputFiles(src)
  await p.getByTestId('proof-status').filter({ hasText: 'source.png' }).filter({ hasText: 'proofed in' }).waitFor({ timeout: 60000 })
  await p.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = p.getByRole('dialog')
  await dialog.getByRole('button', { name: /Render 3 files/ }).click()
  await dialog.getByRole('list', { name: 'Rendered files' }).waitFor({ timeout: 240000 })
  const files = {}
  for (const f of ['print-composite.png', 'ink-1.png', 'ink-2.png']) {
    const dl = p.waitForEvent('download')
    await dialog.getByRole('listitem').filter({ hasText: f }).getByRole('button', { name: 'Download' }).click()
    const d = await dl
    const path = `${dir}${d.suggestedFilename()}`
    await d.saveAs(path)
    const bytes = readFileSync(path)
    const img = PNG.sync.read(bytes)
    files[d.suggestedFilename()] = { width: img.width, height: img.height, bytes: bytes.length, sha256: createHash('sha256').update(img.data).digest('hex').slice(0, 16) }
  }
  summary.push({ fixture: name, source: `${w}×${h}`, files })
  console.log(name, JSON.stringify(files))
  await ctx.close()
}
writeFileSync(`${OUT}summary.json`, JSON.stringify(summary, null, 2))
await browser.close()
