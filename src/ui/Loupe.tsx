import { useEffect, useRef, useState } from 'react'
import type { RenderMode } from '../engine/render'
import { SHEET_LONG_EDGE_MM, type PrintSettings } from '../engine/types'
import type { LoupeScale } from '../state/useStudio'
import type { Region, RenderPool } from '../worker/pool'
import type { SourcePayload } from '../worker/protocol'
import { useMedia } from './useMedia'

/** The loupe looks at the export's own pixels: A4 at 300 dpi (3508 px long edge). */
export const LOUPE_LONG_EDGE = 3508

export interface LoupePoint {
  /** CSS pixels from the sheet's top-left */
  x: number
  y: number
  /** a finger is on the glass: float the loupe above it */
  lifted: boolean
}

interface LoupeProps {
  pool: RenderPool
  source: SourcePayload
  settings: PrintSettings
  mode: RenderMode
  point: LoupePoint
  sheetCss: { w: number; h: number }
  scale: LoupeScale
  dpr: number
}

/**
 * A magnifier tied to the real renderer: the window under the pointer is
 * rendered by the same engine at the export resolution and drawn with one
 * exported pixel per device pixel (1:1) or per 2×2 device pixels (2:1) —
 * no smoothing, no texture, no upscaled preview.
 */
export function Loupe({ pool, source, settings, mode, point, sheetCss, scale, dpr }: LoupeProps) {
  const phone = useMedia('(max-width: 899px)')
  const size = phone ? 148 : 188
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pending, setPending] = useState(true)
  /** which window the glass currently shows (lets tests wait for the exact render) */
  const [drawn, setDrawn] = useState('')
  const device = Math.round(size * dpr)
  const span = Math.ceil(device / scale) // exported pixels across the glass
  const cssLong = Math.max(sheetCss.w, sheetCss.h)
  const perCss = LOUPE_LONG_EDGE / cssLong
  const cx = Math.round(point.x * perCss)
  const cy = Math.round(point.y * perCss)

  useEffect(() => {
    let live = true
    setPending(true)
    const region: Region = { rowStart: cy - (span >> 1), rowEnd: cy - (span >> 1) + span, colStart: cx - (span >> 1), colEnd: cx - (span >> 1) + span }
    pool.render(source, settings, mode, LOUPE_LONG_EDGE, { lane: 'loupe', region }).then((r) => {
      const c = canvas.current
      if (!live || !r || !r.region || !c) return
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#1d1916'
      ctx.fillRect(0, 0, c.width, c.height)
      const tile = new OffscreenCanvas(r.image.width, r.image.height)
      tile.getContext('2d')!.putImageData(r.image, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(tile, (r.region.colStart - region.colStart) * scale, (r.region.rowStart - region.rowStart) * scale, r.image.width * scale, r.image.height * scale)
      setPending(false)
      setDrawn(`${cx},${cy},${span}`)
    }, () => live && setPending(false))
    return () => {
      live = false
    }
  }, [pool, source, settings, mode, cx, cy, span, scale])

  const magnification = (LOUPE_LONG_EDGE * scale) / dpr / cssLong
  const fieldMm = (span * SHEET_LONG_EDGE_MM) / LOUPE_LONG_EDGE
  return (
    <div className={`loupe${pending ? ' is-pending' : ''}`} aria-hidden="true"
      style={{ left: point.x, top: point.y - (point.lifted ? size * 0.85 : 0), width: size, height: size }}>
      <canvas ref={canvas} width={device} height={device} data-testid="loupe" data-long-edge={LOUPE_LONG_EDGE} data-span={span} data-cx={cx} data-cy={cy} data-drawn={drawn} />
      <span className="loupe__readout mono">×{magnification.toFixed(1)} · 300 dpi · {fieldMm.toFixed(1)} mm</span>
    </div>
  )
}
