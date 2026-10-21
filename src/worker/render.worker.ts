/// <reference lib="webworker" />
/**
 * Render worker: owns a copy of the source pixels and the coverage maps, and
 * renders row bands of the sheet on request. The same file runs the preview
 * pool and the export job, so they cannot diverge.
 */
import { separate, type CoverageMaps } from '../engine/separations'
import { createScratch, renderRows, sheetLayout, STRIP_ROWS } from '../engine/render'
import { paintSample } from '../engine/sample'
import type { PrintSettings } from '../engine/types'
import type { ExportOutput, FromWorker, SourcePayload, ToWorker } from './protocol'

const ctx = self as unknown as DedicatedWorkerGlobalScope

let sourceId = -1
let source: { width: number; height: number; rgba: Uint8ClampedArray } | null = null
let maps: { key: string; maps: CoverageMaps } | null = null

function load(payload: SourcePayload) {
  if (payload.kind === 'sample') {
    source = { width: payload.width, height: payload.height, rgba: paintSample(payload.width, payload.height) }
  } else {
    source = { width: payload.width, height: payload.height, rgba: payload.rgba }
  }
  maps = null
}

/** Coverage maps depend only on these settings; reuse them across plate/screen/paper edits. */
function mapsFor(settings: PrintSettings): CoverageMaps {
  if (!source) throw new Error('No source loaded')
  const key = JSON.stringify([settings.paper.color, settings.inks[1].color, settings.separation])
  if (maps?.key !== key) {
    maps = { key, maps: separate(source.rgba, source.width, source.height, settings.paper.color, settings.inks, settings.separation) }
  }
  return maps.maps
}

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer)
}

async function exportFiles(id: number, settings: PrintSettings, longEdge: number, outputs: ExportOutput[]) {
  const m = mapsFor(settings)
  const layout = sheetLayout(source!.width, source!.height, longEdge, settings.paper.margin)
  const files: Array<{ output: ExportOutput; blob: Blob; width: number; height: number }> = []
  const strips = Math.ceil(layout.height / STRIP_ROWS)
  const total = strips * outputs.length
  let done = 0
  const scratch = createScratch(layout.width)
  for (const output of outputs) {
    const rgba = new Uint8ClampedArray(layout.width * layout.height * 4)
    for (let y = 0; y < layout.height; y += STRIP_ROWS) {
      renderRows({ maps: m, source: source!.rgba }, { settings, mode: output, layout, rowStart: y, rowEnd: Math.min(layout.height, y + STRIP_ROWS) }, rgba, scratch)
      done++
      if (done % 8 === 0) post({ type: 'progress', id, done, total, stage: output })
    }
    post({ type: 'progress', id, done, total, stage: `encoding ${output}` })
    const canvas = new OffscreenCanvas(layout.width, layout.height)
    const c2d = canvas.getContext('2d')
    if (!c2d) throw new Error('2D canvas is unavailable in this browser’s workers')
    c2d.putImageData(new ImageData(rgba, layout.width, layout.height), 0, 0)
    files.push({ output, blob: await canvas.convertToBlob({ type: 'image/png' }), width: layout.width, height: layout.height })
  }
  post({ type: 'exported', id, files })
}

ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  try {
    if (msg.type === 'paint') {
      const rgba = paintSample(msg.width, msg.height)
      post({ type: 'painted', id: msg.id, rgba }, [rgba.buffer])
      return
    }
    if (msg.type === 'source') {
      sourceId = msg.sourceId
      load(msg.source)
      return
    }
    if (msg.sourceId !== sourceId || !source) throw new Error('Source not ready')
    if (msg.type === 'render') {
      const t = performance.now()
      const m = mapsFor(msg.settings)
      const layout = sheetLayout(source.width, source.height, msg.longEdge, msg.settings.paper.margin)
      const rowEnd = Math.min(layout.height, msg.rowEnd)
      const rows = Math.max(0, rowEnd - msg.rowStart)
      const pixels = new Uint8ClampedArray(layout.width * rows * 4)
      const scratch = createScratch(layout.width, rows)
      renderRows({ maps: m, source: source.rgba }, { settings: msg.settings, mode: msg.mode, layout, rowStart: msg.rowStart, rowEnd, outRowStart: msg.rowStart }, pixels, scratch)
      post({ type: 'rows', id: msg.id, rowStart: msg.rowStart, rowEnd, width: layout.width, height: layout.height, pixels, ms: performance.now() - t }, [pixels.buffer])
      return
    }
    if (msg.type === 'export') await exportFiles(msg.id, msg.settings, msg.longEdge, msg.outputs)
  } catch (err) {
    post({ type: 'error', id: 'id' in msg ? msg.id : -1, message: err instanceof Error ? err.message : String(err) })
  }
}
