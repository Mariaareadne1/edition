import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { collectErrors, freshStudio, proofStats, readPng, settledProof, TMP, waitForProof } from './helpers'

test.describe.configure({ timeout: 120_000 })

test('the loupe shows the export’s own 300 dpi pixels, exactly', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = collectErrors(page)
  await freshStudio(page)
  await page.getByRole('button', { name: 'Loupe' }).click()
  await page.getByRole('button', { name: '1:1' }).click()
  const box = (await page.getByTestId('sheet').boundingBox())!
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45)
  const loupe = page.getByTestId('loupe')
  await expect(loupe).toHaveAttribute('data-long-edge', '3508')
  // Wait until the glass shows the window for the current pointer position.
  await expect.poll(async () => {
    const [cx, cy, span, drawn] = await Promise.all(['data-cx', 'data-cy', 'data-span', 'data-drawn'].map((a) => loupe.getAttribute(a)))
    return drawn === `${cx},${cy},${span}`
  }, { timeout: 20_000 }).toBe(true)
  const glass = await loupe.evaluate((c: HTMLCanvasElement) => {
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    return { data: Array.from(data), width, height, cx: Number(c.dataset.cx), cy: Number(c.dataset.cy), span: Number(c.dataset.span) }
  })
  expect(glass.width).toBe(glass.span) // 1:1 at devicePixelRatio 1

  // Export the composite at A4 / 300 dpi and compare the same window, pixel for pixel.
  await page.getByRole('button', { name: 'Loupe' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('checkbox').nth(1).uncheck()
  await dialog.getByRole('checkbox').nth(2).uncheck()
  await dialog.getByRole('button', { name: /Render 1 file/ }).click()
  await expect(dialog.getByRole('list', { name: 'Rendered files' })).toBeVisible({ timeout: 180_000 })
  const dl = page.waitForEvent('download')
  await dialog.getByRole('listitem').filter({ hasText: 'print-composite.png' }).getByRole('button', { name: 'Download' }).click()
  const path = join(TMP, `loupe-${Date.now()}.png`)
  await (await dl).saveAs(path)
  const png = readPng(path)
  expect(Math.max(png.width, png.height)).toBe(3508)

  const x0 = glass.cx - (glass.span >> 1)
  const y0 = glass.cy - (glass.span >> 1)
  let compared = 0
  let differing = 0
  for (let y = 0; y < glass.span; y++)
    for (let x = 0; x < glass.span; x++) {
      const px = x0 + x
      const py = y0 + y
      if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue
      const i = (y * glass.width + x) * 4
      const j = (py * png.width + px) * 4
      compared++
      if (glass.data[i] !== png.data[j] || glass.data[i + 1] !== png.data[j + 1] || glass.data[i + 2] !== png.data[j + 2]) differing++
    }
  console.log(`[loupe parity] ${compared} pixels at (${glass.cx}, ${glass.cy}) of ${png.width}×${png.height}: ${differing} differ`)
  expect(compared).toBeGreaterThan(30_000)
  expect(differing).toBe(0)
  expect(errors).toEqual([])
})

test('changing views, tools and plates never creates an undo step or loses focus', async ({ page }) => {
  await freshStudio(page)
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeDisabled()
  // Keyboard path (WebKit, like Safari, does not focus buttons on click).
  await page.getByRole('button', { name: 'Plate 1', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Plate 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Arrow keys rove through the views and press them.
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: 'Plate 2', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Plate 2', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /Pick up plate 1/ }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /Pick up plate 1/ })).toBeFocused()
  await expect(page.getByRole('heading', { name: /Plate 01/ })).toBeVisible()
  await page.getByRole('button', { name: 'Loupe' }).click()
  await page.getByRole('button', { name: 'Loupe' }).click()
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  await page.getByRole('button', { name: /Workshop drawer/ }).click()
  await expect(undo).toBeDisabled()
})

test('the plate in hand is the one a drag moves', async ({ page }) => {
  await freshStudio(page)
  await page.getByRole('button', { name: /Pick up plate 1/ }).click()
  const shiftX = page.getByRole('textbox', { name: 'Shift X' })
  await expect(shiftX).toHaveValue('0.00')
  const box = (await page.getByTestId('sheet').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 5, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  const mm = 5 * (297 / Math.max(box.width, box.height))
  await expect.poll(async () => Number(await shiftX.inputValue())).toBeCloseTo(mm, 1)
  // Plate 2 kept its own register.
  await page.getByRole('button', { name: /Pick up plate 2/ }).click()
  await expect(shiftX).toHaveValue('0.60')
})

test('holding Separate lifts two real, distinct plates apart; releasing restores the print', async ({ page }) => {
  await freshStudio(page)
  const before = await proofStats(page)
  await page.getByTestId('sheet').focus()
  await page.keyboard.down('s')
  await expect(page.locator('.fan__plate.is-ready')).toHaveCount(2, { timeout: 20_000 })
  const plates = await page.locator('.fan__plate canvas').evaluateAll((cs) => (cs as HTMLCanvasElement[]).map((c) => {
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    // Mean of (blue − red): plate 1 is cobalt, plate 2 vermilion.
    let br = 0
    for (let i = 0; i < data.length; i += 4) br += data[i + 2]! - data[i]!
    return { w: c.width, lean: br / (data.length / 4) }
  }))
  expect(plates[0]!.w).toBeGreaterThan(200)
  expect(plates[0]!.lean).toBeGreaterThan(5)
  expect(plates[1]!.lean).toBeLessThan(-5)
  await page.keyboard.up('s')
  await expect(page.locator('.sheet-wrap.is-separated')).toHaveCount(0)
  expect((await proofStats(page)).hash).toBe(before.hash) // a UI state, never the print
})

test('the split handle works from the keyboard and reports its position', async ({ page }) => {
  await freshStudio(page)
  await page.getByRole('button', { name: 'Split', exact: true }).click()
  const grip = page.getByRole('slider', { name: 'Comparison position' })
  await grip.focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(grip).toHaveAttribute('aria-valuenow', '38')
  await page.keyboard.press('End')
  await expect(grip).toHaveAttribute('aria-valuenow', '100')
})

test('the drag hint goes once used, and stays gone', async ({ page }) => {
  await freshStudio(page)
  await page.evaluate(() => localStorage.removeItem('edition.hint.drag'))
  await page.reload()
  await waitForProof(page)
  await expect(page.getByText(/Drag the print to shift/)).toBeVisible()
  await page.getByTestId('sheet').focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByText(/Drag the print to shift/)).toHaveCount(0)
  await page.reload()
  await waitForProof(page)
  await expect(page.getByText(/Drag the print to shift/)).toHaveCount(0)
})

test('undo and redo after a drag, and after a reload', async ({ page }) => {
  await freshStudio(page)
  const shiftY = page.getByRole('textbox', { name: 'Shift Y' })
  const sheet = page.getByTestId('sheet')
  const drag = async (dy: number) => {
    const b = (await sheet.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy, { steps: 6 })
    await page.mouse.up()
  }
  await drag(4)
  const afterDrag = await shiftY.inputValue()
  expect(afterDrag).not.toBe('-0.40')
  await expect(page.getByTestId('proof-status')).toContainText('Saved')
  await page.reload()
  await settledProof(page)
  await expect(shiftY).toHaveValue(afterDrag) // the drag was saved
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled() // history starts fresh
  await drag(-6)
  const second = await shiftY.inputValue()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(shiftY).toHaveValue(afterDrag)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(shiftY).toHaveValue(second)
})

test('an export can be cancelled; nothing is written', async ({ page }) => {
  await freshStudio(page)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Render 3 files/ }).click()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog.getByRole('status')).toContainText('Export cancelled; nothing was written.')
  await expect(dialog.getByRole('list', { name: 'Rendered files' })).toHaveCount(0)
  // And the studio is still live behind it.
  await page.keyboard.press('Escape')
  await waitForProof(page)
})

test('ink recipes and custom colours drive the real print, one undo step each', async ({ page }) => {
  await freshStudio(page)
  const base = await proofStats(page)
  await page.getByRole('button', { name: /Indigo & Ochre/ }).click()
  await settledProof(page)
  const indigo = await proofStats(page)
  expect(indigo.hash).not.toBe(base.hash)
  await expect(page.getByRole('button', { name: /Pick up plate 2: Ochre/ })).toBeVisible()
  await page.getByLabel('Ink 2 colour').fill('#118855')
  await page.getByLabel('Ink 2 colour').blur()
  await settledProof(page)
  expect((await proofStats(page)).hash).not.toBe(indigo.hash)
  await page.getByRole('button', { name: 'Undo' }).click()
  await settledProof(page)
  expect((await proofStats(page)).hash).toBe(indigo.hash)
  await page.getByRole('button', { name: 'Undo' }).click()
  await settledProof(page)
  expect((await proofStats(page)).hash).toBe(base.hash)
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the tray is a bottom sheet that Back and Escape close', async ({ page }) => {
    await freshStudio(page)
    await page.getByRole('button', { name: 'Adjust' }).click()
    await expect(page.getByRole('heading', { name: /Plate 02/ })).toBeFocused()
    await page.goBack()
    await expect(page.getByRole('complementary', { name: 'Ink tray' })).toBeHidden()
    await expect(page.getByTestId('sheet')).toBeVisible() // still in the studio
    await page.getByRole('button', { name: 'Adjust' }).click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('complementary', { name: 'Ink tray' })).toBeHidden()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('a touch drag moves the plate; a second finger cancels it without an undo step', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'raw touch events are driven through the Chromium DevTools protocol')
    await freshStudio(page)
    const cdp = await page.context().newCDPSession(page)
    const b = (await page.getByTestId('sheet').boundingBox())!
    const [x, y] = [b.x + b.width / 2, b.y + b.height / 2]
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<[number, number]>) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([px, py], id) => ({ x: px, y: py, id })) })
    await page.getByRole('button', { name: 'Adjust' }).click()
    const shiftX = page.getByRole('textbox', { name: 'Shift X' })
    await page.getByRole('button', { name: 'Close tray' }).click()

    await touch('touchStart', [[x, y]])
    for (let i = 1; i <= 6; i++) await touch('touchMove', [[x + i * 2, y]])
    await touch('touchEnd', [])
    await page.getByRole('button', { name: 'Adjust' }).click()
    const moved = Number(await shiftX.inputValue())
    expect(moved).toBeGreaterThan(0.6)
    await page.getByRole('button', { name: 'Close tray' }).click()
    await page.getByRole('button', { name: 'Undo' }).click()

    // Pinch: two fingers down → the plate goes back where it started, and no undo step is added.
    await touch('touchStart', [[x, y]])
    await touch('touchMove', [[x + 10, y]])
    await touch('touchStart', [[x + 10, y], [x + 60, y + 40]])
    await touch('touchMove', [[x + 20, y], [x + 80, y + 60]])
    await touch('touchEnd', [])
    await page.getByRole('button', { name: 'Adjust' }).click()
    await expect(shiftX).toHaveValue('0.60')
    await expect(page.getByRole('button', { name: 'Redo' })).toBeEnabled() // the earlier undo is still redoable
  })
})
