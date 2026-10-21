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
  await p.reload()
  await settle(p)
  return p
}

const shot = async (p, name) => { await settle(p); await p.screenshot({ path: `${OUT}${name}`, type: 'jpeg', quality: 86 }) }

const d = await open({ width: 1440, height: 900 })
await shot(d, 'edition-print.jpg')
await d.getByRole('button', { name: 'Loupe' }).click()
await shot(d, 'edition-loupe.jpg')
await d.getByRole('button', { name: 'Fit' }).click()
await d.getByRole('button', { name: 'Ink 2', exact: true }).click()
await shot(d, 'edition-ink2.jpg')
await d.getByRole('button', { name: 'Compare' }).click()
await d.waitForTimeout(800)
await shot(d, 'edition-compare.jpg')
await d.getByRole('button', { name: 'Print', exact: true }).click()
await d.getByRole('button', { name: /Indigo/ }).click()
await shot(d, 'edition-indigo-ochre.jpg')
await d.getByRole('button', { name: /Evergreen/ }).click()
await shot(d, 'edition-evergreen-vermilion.jpg')
await d.getByRole('button', { name: 'Export', exact: true }).click()
await d.waitForTimeout(300)
await d.screenshot({ path: `${OUT}edition-export.jpg`, type: 'jpeg', quality: 86 })

const m = await open({ width: 390, height: 844 }, { hasTouch: true, isMobile: true })
await shot(m, 'edition-mobile.jpg')

await browser.close()
console.log('written to', OUT)
