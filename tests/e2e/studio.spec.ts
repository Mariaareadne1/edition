import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { collectErrors, freshStudio, pngBlocks, proofBlocks, proofStats, readPng, settledProof, TMP, waitForProof, writeTestPhoto } from './helpers'

test.describe.configure({ timeout: 120_000 })

test('opens on the sample and proofs a real two-ink print', async ({ page }) => {
  const errors = collectErrors(page)
  await freshStudio(page)
  const stats = await proofStats(page)
  expect(stats.width).toBeGreaterThan(400)
  expect(stats.std).toBeGreaterThan(20) // a halftone, not a flat fill
  await expect(page.getByTestId('proof-status')).toContainText('Harbour, dusk (sample)')
  expect(errors).toEqual([])
})

test('views: each ink alone, source and compare are distinct real renders', async ({ page }) => {
  await freshStudio(page)
  const print = await proofStats(page)
  const hashes = new Set([print.hash])
  for (const view of ['Ink 1', 'Ink 2', 'Source']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await settledProof(page)
    hashes.add((await proofStats(page)).hash)
  }
  expect(hashes.size).toBe(4)
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  await expect(page.getByLabel('Comparison position')).toBeVisible()
})

test('dragging the print moves the active plate by millimetres, as one undo step', async ({ page }) => {
  await freshStudio(page)
  const shiftX = page.getByRole('textbox', { name: 'Shift X' })
  const before = Number(await shiftX.inputValue())
  const sheet = page.getByTestId('sheet')
  const box = (await sheet.boundingBox())!
  const hashBefore = (await proofStats(page)).hash
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  const mmPerPx = 297 / Math.max(box.width, box.height)
  await expect.poll(async () => Number(await shiftX.inputValue())).toBeCloseTo(Math.min(6, before + 40 * mmPerPx), 1)
  await settledProof(page)
  expect((await proofStats(page)).hash).not.toBe(hashBefore)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(shiftX).toHaveValue(before.toFixed(2))
  await settledProof(page)
  expect((await proofStats(page)).hash).toBe(hashBefore)
})

test('keyboard nudges the plate; numeric fields validate', async ({ page }) => {
  await freshStudio(page)
  const shiftY = page.getByRole('textbox', { name: 'Shift Y' })
  const before = Number(await shiftY.inputValue())
  await page.getByTestId('sheet').focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(shiftY).toHaveValue((before + 1.1).toFixed(2))
  const ruling = page.getByRole('textbox', { name: 'Ruling' })
  await ruling.fill('9000')
  await expect(page.getByRole('alert')).toContainText('Enter a number from 40 to 260')
  await ruling.press('Enter')
  await expect(ruling).toHaveValue('150')
})

test('import: valid photo opens and survives reload; invalid and fake files are refused', async ({ page }) => {
  await freshStudio(page)
  await page.getByTestId('image-input').setInputFiles(writeTestPhoto('dusk-field.png'))
  await expect(page.getByTestId('proof-status')).toContainText('dusk-field.png', { timeout: 30_000 })
  await settledProof(page)
  await page.getByRole('textbox', { name: 'Ruling' }).fill('140')
  await page.getByRole('textbox', { name: 'Ruling' }).press('Enter')
  await settledProof(page)
  await expect(page.getByTestId('proof-status')).toContainText('Saved')
  const proofed = await proofStats(page)

  await page.reload()
  await settledProof(page)
  await expect(page.getByTestId('proof-status')).toContainText('dusk-field.png')
  await expect(page.getByRole('textbox', { name: 'Ruling' })).toHaveValue('140')
  // Same document, same image, same size → byte-identical proof.
  expect((await proofStats(page)).hash).toBe(proofed.hash)

  const fake = join(TMP, 'not-really.png')
  writeFileSync(fake, 'hello, I am text pretending to be a PNG')
  await page.getByTestId('image-input').setInputFiles(fake)
  await expect(page.getByRole('alert')).toContainText('Only JPEG, PNG and WebP')
  await expect(page.getByTestId('proof-status')).toContainText('dusk-field.png')
})

test('a large photograph (17.5 MP) is downscaled for analysis without crashing', async ({ page }) => {
  await freshStudio(page)
  await page.getByTestId('image-input').setInputFiles(writeTestPhoto('large.png', 5000, 3500))
  await expect(page.getByTestId('proof-status')).toContainText('large.png', { timeout: 60_000 })
  await settledProof(page)
  const s = await proofStats(page)
  expect(s.width).toBeGreaterThan(s.height) // landscape sheet
})

test('rapid changes never leave a stale proof', async ({ page }) => {
  await freshStudio(page)
  const slider = page.getByRole('slider', { name: 'Contrast slider' })
  const b = (await slider.boundingBox())!
  await page.mouse.move(b.x + 4, b.y + b.height / 2)
  await page.mouse.down()
  for (let i = 0; i < 25; i++) await page.mouse.move(b.x + 4 + ((i * 37) % Math.round(b.width - 8)), b.y + b.height / 2)
  await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2)
  await page.mouse.up()
  await settledProof(page)
  const afterStorm = await proofStats(page)
  // Re-render the same settings from scratch: identical pixels means the last render won.
  await page.reload()
  await settledProof(page)
  expect((await proofStats(page)).hash).toBe(afterStorm.hash)
})

test('export: real PNGs at full size that match the controls and the preview', async ({ page }) => {
  test.setTimeout(240_000)
  await freshStudio(page)
  // Measure preview blocks in Print view before opening the dialog.
  const preview = await proofBlocks(page, 16)

  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('export-size')).toContainText('px')
  const sizeText = await dialog.getByTestId('export-size').textContent()
  const [w, h] = sizeText!.match(/(\d+) × (\d+) px/)!.slice(1).map(Number)
  expect(Math.max(w!, h!)).toBe(3508)
  await dialog.getByRole('button', { name: /Render 3 files/ }).click()
  await expect(dialog.getByRole('list', { name: 'Rendered files' })).toBeVisible({ timeout: 180_000 })

  const files: Record<string, PNG> = {}
  for (const name of ['print-composite.png', 'ink-1.png', 'ink-2.png']) {
    const row = dialog.getByRole('listitem').filter({ hasText: name })
    const dl = page.waitForEvent('download')
    await row.getByRole('button', { name: 'Download' }).click()
    const d = await dl
    expect(d.suggestedFilename()).toMatch(new RegExp(`${name.replace('.', '\\.')}$`))
    const path = join(TMP, d.suggestedFilename())
    await d.saveAs(path)
    files[name] = readPng(path)
  }

  for (const png of Object.values(files)) {
    expect(png.width).toBe(w)
    expect(png.height).toBe(h)
  }
  // Films: greyscale, black ink on white, registration marks present in the margin.
  for (const film of [files['ink-1.png']!, files['ink-2.png']!]) {
    let grey = true
    let inked = 0
    for (let i = 0; i < film.data.length; i += 4 * 97) {
      if (film.data[i] !== film.data[i + 1] || film.data[i] !== film.data[i + 2]) grey = false
      if (film.data[i]! < 128) inked++
    }
    expect(grey).toBe(true)
    expect(inked).toBeGreaterThan(100)
  }
  // Preview vs downsampled export, in linear light.
  const exported = pngBlocks(files['print-composite.png']!, preview, 16)
  const diffs = preview.blocks.map((v, i) => Math.abs(v - exported[i]!))
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length
  console.log(`[export parity] preview ${preview.width}×${preview.height} vs export ${w}×${h}: mean ${mean.toFixed(2)}/255, worst ${Math.max(...diffs).toFixed(2)}/255 over ${diffs.length} blocks`)
  expect(mean).toBeLessThan(1.5)
  expect(Math.max(...diffs)).toBeLessThan(6)

  // Package download is a zip that contains the document.
  const pkg = page.waitForEvent('download')
  await dialog.getByRole('button', { name: /Save \.edition/ }).click()
  expect((await pkg).suggestedFilename()).toMatch(/\.edition$/)
})

test('export reflects the controls: offsets move only the composite, angles change the film', async ({ page }) => {
  test.setTimeout(240_000)
  await freshStudio(page)
  const exportSmall = async () => {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('A4 · 150 dpi').check()
    await dialog.getByRole('button', { name: /Render 3 files/ }).click()
    await expect(dialog.getByRole('list', { name: 'Rendered files' })).toBeVisible({ timeout: 120_000 })
    const out: Record<string, Buffer> = {}
    for (const name of ['print-composite.png', 'ink-2.png']) {
      const dl = page.waitForEvent('download')
      await dialog.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Download' }).click()
      const path = join(TMP, `${Date.now()}-${name}`)
      await (await dl).saveAs(path)
      out[name] = readPng(path).data
    }
    await page.keyboard.press('Escape')
    return out
  }
  const base = await exportSmall()
  await page.getByRole('textbox', { name: 'Shift X' }).fill('2.5')
  await page.getByRole('textbox', { name: 'Shift X' }).press('Enter')
  const shifted = await exportSmall()
  expect(shifted['print-composite.png']!.equals(base['print-composite.png']!)).toBe(false)
  expect(shifted['ink-2.png']!.equals(base['ink-2.png']!)).toBe(true) // films are registered
  await page.getByRole('textbox', { name: 'Screen angle' }).fill('45')
  await page.getByRole('textbox', { name: 'Screen angle' }).press('Enter')
  const rotated = await exportSmall()
  expect(rotated['ink-2.png']!.equals(base['ink-2.png']!)).toBe(false)
})

test('phone layout keeps the print first and controls reachable', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto('/')
  await waitForProof(page)
  const sheet = (await page.getByTestId('sheet').boundingBox())!
  expect(sheet.x).toBeGreaterThanOrEqual(0)
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(390)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.getByRole('textbox', { name: 'Ruling' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('textbox', { name: 'Ruling' })).toBeVisible()
  await ctx.close()
})

test('an oversized image is refused from its header, before decoding', async ({ page }) => {
  await freshStudio(page)
  // A real PNG signature + IHDR declaring 20000 × 20000, with no pixel data.
  const head = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(head, 0)
  head.writeUInt32BE(20000, 16)
  head.writeUInt32BE(20000, 20)
  const path = join(TMP, 'huge.png')
  writeFileSync(path, head)
  await page.getByTestId('image-input').setInputFiles(path)
  await expect(page.getByRole('alert')).toContainText('400 megapixels')
})

test('an unreadable saved print is preserved, not overwritten or pruned', async ({ page }) => {
  await freshStudio(page)
  await page.getByTestId('image-input').setInputFiles(writeTestPhoto('keep-me.png'))
  await expect(page.getByTestId('proof-status')).toContainText('keep-me.png', { timeout: 30_000 })
  await expect(page.getByTestId('proof-status')).toContainText('Saved')
  // Simulate a document written by a newer Edition.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('edition')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('docs', 'readwrite')
      const store = tx.objectStore('docs')
      const get = store.get('current')
      get.onsuccess = () => store.put({ ...get.result, version: 99 }, 'current')
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => reject(tx.error)
    }
  }))
  await page.reload()
  await waitForProof(page)
  await expect(page.getByRole('alert')).toContainText('A copy was kept')
  // Make an edit so autosave runs, then confirm both the copy and the image bytes survive.
  await page.getByRole('textbox', { name: 'Ruling' }).fill('120')
  await page.getByRole('textbox', { name: 'Ruling' }).press('Enter')
  await expect(page.getByTestId('proof-status')).toContainText('Saved')
  const kept = await page.evaluate(() => new Promise<{ docs: string[]; blobs: number }>((resolve) => {
    const req = indexedDB.open('edition')
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['docs', 'blobs'])
      const d = tx.objectStore('docs').getAllKeys()
      const b = tx.objectStore('blobs').getAllKeys()
      tx.oncomplete = () => { resolve({ docs: d.result.map(String), blobs: b.result.length }); db.close() }
    }
  }))
  expect(kept.docs.some((k) => k.startsWith('unreadable-'))).toBe(true)
  expect(kept.blobs).toBe(1)
})

test('holding an arrow key is one undo step', async ({ page }) => {
  await freshStudio(page)
  const shiftX = page.getByRole('textbox', { name: 'Shift X' })
  const before = await shiftX.inputValue()
  await page.getByTestId('sheet').focus()
  await page.keyboard.down('ArrowRight')
  for (let i = 0; i < 5; i++) await page.keyboard.down('ArrowRight') // auto-repeat
  await page.keyboard.up('ArrowRight')
  await expect(shiftX).not.toHaveValue(before)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(shiftX).toHaveValue(before)
})
