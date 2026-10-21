import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { sheetLayout, type RenderMode } from '../engine/render'
import { SHEET_LONG_EDGE_MM, type PrintSettings, type Registration } from '../engine/types'
import { LIMITS } from '../state/document'
import type { RenderPool } from '../worker/pool'
import type { SourcePayload } from '../worker/protocol'

export type ViewMode = 'print' | 'ink1' | 'ink2' | 'source' | 'compare'
export type Zoom = 'fit' | 'detail'

interface PrintCanvasProps {
  pool: RenderPool
  source: SourcePayload
  settings: PrintSettings
  view: ViewMode
  zoom: Zoom
  activePlate: 0 | 1
  onPreview: (s: PrintSettings) => void
  onPush: (s: PrintSettings) => void
  onCommit: () => void
  onStatus: (status: { busy: boolean; ms?: number; size?: [number, number]; error?: string }) => void
}

const MIN_LONG_EDGE = 480
const MAX_PREVIEW_LONG_EDGE = 2400

const round2 = (v: number) => Math.round(v * 100) / 100
const clampOffset = (v: number) => Math.min(LIMITS.offset.max, Math.max(LIMITS.offset.min, round2(v)))

function withRegistration(s: PrintSettings, k: 0 | 1, reg: Registration): PrintSettings {
  const registration: PrintSettings['registration'] = [...s.registration] as PrintSettings['registration']
  registration[k] = reg
  return { ...s, registration }
}

export function PrintCanvas({ pool, source, settings, view, zoom, activePlate, onPreview, onCommit, onStatus }: PrintCanvasProps) {
  const desk = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const sourceCanvas = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 800, h: 800 })
  const [split, setSplit] = useState(50)
  const drag = useRef<{ x: number; y: number; start: Registration; pointerId: number } | null>(null)

  // Fit the sheet into the desk.
  useLayoutEffect(() => {
    const el = desk.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect
      setBox({ w: Math.max(200, r.width), h: Math.max(200, r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = sheetLayout(source.width, source.height, 1000, settings.paper.margin)
  const aspect = layout.width / layout.height
  const pad = box.w < 500 ? 16 : 48
  const fitW = Math.min(box.w - pad, (box.h - pad) * aspect)
  const scaleFactor = zoom === 'detail' ? 2.2 : 1
  const cssW = Math.max(160, fitW * scaleFactor)
  const cssH = cssW / aspect
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const longEdge = Math.round(Math.min(MAX_PREVIEW_LONG_EDGE, Math.max(MIN_LONG_EDGE, Math.max(cssW, cssH) * dpr)))

  const mode: RenderMode = view === 'compare' ? 'print' : view

  // Render the proof whenever anything that affects pixels changes.
  useEffect(() => {
    let live = true
    onStatus({ busy: true })
    pool.render(source, settings, mode, longEdge).then((r) => {
      if (!live || !r) return
      const c = canvas.current
      if (!c) return
      c.width = r.image.width
      c.height = r.image.height
      c.getContext('2d')!.putImageData(r.image, 0, 0)
      onStatus({ busy: false, ms: r.ms, size: [r.image.width, r.image.height] })
    }, (err: Error) => live && onStatus({ busy: false, error: err.message }))
    return () => {
      live = false
    }
  }, [pool, source, settings, mode, longEdge, onStatus])

  useEffect(() => {
    if (view !== 'compare') return
    let live = true
    // Rendered after the print; the pool's latest-wins queue keeps this cheap.
    const t = window.setTimeout(() => {
      pool.render(source, settings, 'source', longEdge).then((r) => {
        const c = sourceCanvas.current
        if (!live || !r || !c) return
        c.width = r.image.width
        c.height = r.image.height
        c.getContext('2d')!.putImageData(r.image, 0, 0)
      }, () => {})
    }, 120)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [pool, source, settings, view, longEdge])

  const canDrag = view === 'print' || view === 'compare' || (view === 'ink1' && activePlate === 0) || (view === 'ink2' && activePlate === 1)
  const mmPerCssPx = SHEET_LONG_EDGE_MM / Math.max(cssW, cssH)
  const reg = settings.registration[activePlate]

  return (
    <div ref={desk} className={`desk${zoom === 'detail' ? ' desk--detail' : ''}`}>
      <div
        className={`sheet${canDrag ? ' sheet--draggable' : ''}`}
        style={{ width: cssW, height: cssH }}
        tabIndex={0}
        role="application"
        aria-roledescription="print preview"
        aria-label={`${view === 'compare' ? 'Source and print comparison' : `Proof: ${view}`}. ${canDrag ? `Drag or use arrow keys to move ink ${activePlate + 1}; currently ${reg.dx.toFixed(2)} by ${reg.dy.toFixed(2)} millimetres.` : ''}`}
        data-testid="sheet"
        onPointerDown={(e) => {
          if (!canDrag || e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, start: reg, pointerId: e.pointerId }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || d.pointerId !== e.pointerId) return
          onPreview(withRegistration(settings, activePlate, {
            ...d.start,
            dx: clampOffset(d.start.dx + (e.clientX - d.x) * mmPerCssPx),
            dy: clampOffset(d.start.dy + (e.clientY - d.y) * mmPerCssPx),
          }))
        }}
        onPointerUp={() => {
          if (!drag.current) return
          drag.current = null
          onCommit()
        }}
        onPointerCancel={() => {
          if (!drag.current) return
          drag.current = null
          onCommit()
        }}
        onKeyDown={(e) => {
          if (!canDrag) return
          const step = e.shiftKey ? 1 : 0.1
          const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
          if (!delta) return
          e.preventDefault()
          // Preview while the key is held; commit on keyup — one undo step per press-and-hold.
          onPreview(withRegistration(settings, activePlate, { ...reg, dx: clampOffset(reg.dx + delta[0]!), dy: clampOffset(reg.dy + delta[1]!) }))
        }}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow')) onCommit()
        }}
        onBlur={onCommit}
      >
        <canvas ref={canvas} className="sheet__canvas" data-testid="proof" />
        {view === 'compare' && (
          <>
            <canvas ref={sourceCanvas} className="sheet__canvas sheet__canvas--source" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} aria-hidden="true" />
            <div className="sheet__split" style={{ left: `${split}%` }} aria-hidden="true">
              <span className="sheet__split-label sheet__split-label--l">Source</span>
              <span className="sheet__split-label sheet__split-label--r">Print</span>
            </div>
          </>
        )}
      </div>
      <p className="visually-hidden" aria-live="polite">
        Ink {activePlate + 1} offset {reg.dx.toFixed(2)} by {reg.dy.toFixed(2)} millimetres
      </p>
      {view === 'compare' && (
        <label className="compare-slider">
          <span className="visually-hidden">Comparison position</span>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} />
        </label>
      )}
    </div>
  )
}
