// Captures the studio at four viewports in Chromium and WebKit, plus short
// interaction videos, into artifacts/<label>/ (git-ignored). Needs `pnpm dev`.
//   node scripts/capture.mjs before|after
import { chromium, webkit } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const APP = process.env.EDITION_URL ?? 'http://localhost:5411/'
const LABEL = process.argv[2] ?? 'capture'
const OUT = new URL(`../artifacts/${LABEL}/`, import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const VIEWPORTS = [[1440, 900], [1280, 800], [768, 1024], [390, 844]]
const proofed = (p) => p.getByTestId('proof-status').filter({ hasText: 'proofed in' }).first().waitFor({ timeout: 60000 })
const settle = async (p) => { await proofed(p); await p.waitForTimeout(500); await proofed(p) }

async function open(browser, [width, height], extra = {}) {
  const mobile = width < 500
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: mobile, isMobile: mobile && browser !== webkitB ? true : undefined, ...extra })
  const p = await ctx.newPage()
  await p.goto(APP)
  await p.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('edition'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
  await p.reload()
  await settle(p)
  return { ctx, p }
}

const chromiumB = await chromium.launch({ args: ['--use-angle=metal'] })
const webkitB = await webkit.launch()
for (const [name, browser] of [['chromium', chromiumB], ['webkit', webkitB]]) {
  for (const vp of VIEWPORTS) {
    const { ctx, p } = await open(browser, vp)
    await p.screenshot({ path: `${OUT}${name}-${vp[0]}x${vp[1]}.jpg`, type: 'jpeg', quality: 82 })
    await ctx.close()
  }
}

// Interaction videos (Chromium, 1440×900).
const steps = {
  drag: async (p) => {
    const b = await p.getByTestId('sheet').boundingBox()
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await p.mouse.down()
    await p.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 20, { steps: 30 })
    await p.mouse.up()
    await settle(p)
  },
  palette: async (p) => {
    for (const n of [/Indigo/, /Evergreen/, /Cobalt/]) {
      await p.getByRole('button', { name: n }).first().click()
      await settle(p)
      await p.waitForTimeout(500)
    }
  },
  export: async (p) => {
    await p.getByRole('button', { name: 'Export', exact: true }).first().click()
    await p.getByRole('dialog').getByLabel('A4 · 150 dpi').check()
    await p.getByRole('dialog').getByRole('button', { name: /Render 3 files/ }).click()
    await p.getByRole('dialog').getByRole('list', { name: 'Rendered files' }).waitFor({ timeout: 120000 })
    await p.waitForTimeout(800)
  },
}
for (const [name, run] of Object.entries(steps)) {
  try {
    const { ctx, p } = await open(chromiumB, [1440, 900], { recordVideo: { dir: `${OUT}video-${name}`, size: { width: 1440, height: 900 } }, deviceScaleFactor: 1 })
    await run(p)
    await ctx.close()
  } catch (err) {
    console.error(`video ${name} failed:`, err.message)
  }
}
await chromiumB.close()
await webkitB.close()
console.log('written to', OUT)
