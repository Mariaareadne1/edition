// Captures README screenshots from the running dev server (pnpm dev).
import { chromium } from '@playwright/test'

const APP = process.env.EDITION_URL ?? 'http://localhost:5411/'
const OUT = new URL('../docs/media/', import.meta.url).pathname
const browser = await chromium.launch({ args: ['--use-angle=metal'] })
const proofed = (p) => p.getByTestId('proof-status').filter({ hasText: 'proofed in' }).waitFor({ timeout: 60000 })
const settle = async (p) => { await proofed(p); await p.waitForTimeout(400); await proofed(p) }

async function open(viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, ...opts })
  const p = await ctx.newPage()
  await p.goto(APP)
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('edition'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
  await p.evaluate(() => localStorage.setItem('edition.hint.drag', 'done'))
  await p.reload()
  await settle(p)
  return p
}

const shot = async (p, name, wait = 0) => {
  await settle(p)
  if (wait) await p.waitForTimeout(wait)
  await p.screenshot({ path: `${OUT}${name}`, type: 'jpeg', quality: 84 })
}
const button = (p, name) => p.getByRole('button', { name, exact: true }).first()

const d = await open({ width: 1440, height: 900 })
await shot(d, 'edition-print.jpg')
await button(d, 'Loupe').click()
const box = await d.getByTestId('sheet').boundingBox()
await d.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.43)
await shot(d, 'edition-loupe.jpg', 1500)
await button(d, 'Loupe').click()
await d.keyboard.down('s')
await shot(d, 'edition-separate.jpg', 1500)
await d.keyboard.up('s')
await button(d, 'Plate 2').click()
await shot(d, 'edition-ink2.jpg')
await button(d, 'Split').click()
await shot(d, 'edition-compare.jpg', 800)
await button(d, 'Print').click()
await d.getByRole('button', { name: /Indigo & Ochre/ }).click()
await shot(d, 'edition-indigo-ochre.jpg')
await d.getByRole('button', { name: /Evergreen & Vermilion/ }).click()
await shot(d, 'edition-evergreen-vermilion.jpg')
await button(d, 'Export').click()
await d.waitForTimeout(400)
await d.screenshot({ path: `${OUT}edition-export.jpg`, type: 'jpeg', quality: 84 })

const m = await open({ width: 390, height: 844 }, { hasTouch: true, isMobile: true })
await shot(m, 'edition-mobile.jpg')
await button(m, 'Adjust').click()
await shot(m, 'edition-mobile-tray.jpg', 500)

await browser.close()
console.log('written to', OUT)
