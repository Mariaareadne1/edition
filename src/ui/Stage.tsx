import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { sheetLayout, type RenderMode } from '../engine/render'
import { SHEET_LONG_EDGE_MM, type PrintSettings, type Registration } from '../engine/types'
import { LIMITS } from '../state/document'
import type { Studio } from '../state/useStudio'
import type { RenderPool } from '../worker/pool'
import type { SourcePayload } from '../worker/protocol'
import { useMedia } from './useMedia'
import { PlateTabs } from './PlateTabs'
import { Loupe, type LoupePoint } from './Loupe'

export interface ProofStatus {
  busy: boolean
  ms?: number
  size?: [number, number]
  error?: string
}

interface StageProps {
  pool: RenderPool
  source: SourcePayload
  settings: PrintSettings
  studio: Studio
  busy: string | null
  onPreview: (s: PrintSettings) => void
  onCommit: () => void
  onStatus: (status: ProofStatus) => void
}

const MIN_LONG_EDGE = 480
const MAX_PREVIEW_LONG_EDGE = 2400
/** room for the plate tabs: beside the sheet on the table, above it on a phone */
const TAB_ROOM_SIDE = 108
const TAB_ROOM_TOP = 44

const round2 = (v: number) => Math.round(v * 100) / 100
const clampOffset = (v: number) => Math.min(LIMITS.offset.max, Math.max(LIMITS.offset.min, round2(v)))
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`

function withRegistration(s: PrintSettings, k: 0 | 1, reg: Registration): PrintSettings {
  const registration = [...s.registration] as PrintSettings['registration']
  registration[k] = reg
  return { ...s, registration }
}

/** Pointer capture can fail for a pointer the browser no longer tracks; dragging still works without it. */
function capture(el: Element, id: number) {
  try {
    el.setPointerCapture(id)
  } catch {
    /* not capturable */
  }
}

function paint(c: HTMLCanvasElement | null, image: ImageData) {
  if (!c) return
  c.width = image.width
  c.height = image.height
  c.getContext('2d')!.putImageData(image, 0, 0)
}

interface Drag {
  x: number
  y: number
  start: Registration
  pointerId: number
  /** millimetres per CSS pixel, measured from the sheet's rendered box at pointer-down (zoom/transform safe) */
  mmPerPx: number
  left: number
  top: number
}

export function Stage({ pool, source, settings, studio, busy, onPreview, onCommit, onStatus }: StageProps) {
  const { view, activePlate, tool, separated, loupeScale } = studio.state
  const { selectPlate, dismissHint } = studio.actions
  const phone = useMedia('(max-width: 899px)')
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const sourceCanvas = useRef<HTMLCanvasElement>(null)
  const plateCanvas = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)] as const
  const [box, setBox] = useState({ w: 800, h: 800 })
  const [split, setSplit] = useState(50)
  const [readout, setReadout] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null)
  const [loupe, setLoupe] = useState<LoupePoint | null>(null)
  const [platesReady, setPlatesReady] = useState(false)
  const [snap, setSnap] = useState(false)
  const drag = useRef<Drag | null>(null)
  const pointers = useRef(new Set<number>())

  // Fit the sheet to the table.
  useLayoutEffect(() => {
    const el = stage.current
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
  const padX = phone ? 16 : 36
  const padY = phone ? 10 : 32
  const availW = box.w - 2 * padX - (phone ? 0 : TAB_ROOM_SIDE)
  const availH = box.h - 2 * padY - (phone ? TAB_ROOM_TOP : 0)
  const cssW = Math.max(160, Math.min(availW, availH * aspect))
  const cssH = cssW / aspect
  const cssLong = Math.max(cssW, cssH)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const longEdge = Math.round(Math.min(MAX_PREVIEW_LONG_EDGE, Math.max(MIN_LONG_EDGE, cssLong * dpr)))
  const mode: RenderMode = view === 'compare' ? 'print' : view

  // The proof: re-rendered whenever anything that affects its pixels changes.
  useEffect(() => {
    let live = true
    onStatus({ busy: true })
    pool.render(source, settings, mode, longEdge).then((r) => {
      if (!live || !r) return
      paint(canvas.current, r.image)
      onStatus({ busy: false, ms: r.ms, size: [r.image.width, r.image.height] })
    }, (err: Error) => live && onStatus({ busy: false, error: err.message }))
    return () => {
      live = false
    }
  }, [pool, source, settings, mode, longEdge, onStatus])

  // Split view: the source, in its own lane so it never displaces the proof.
  useEffect(() => {
    if (view !== 'compare') return
    let live = true
    const t = window.setTimeout(() => {
      pool.render(source, settings, 'source', longEdge).then((r) => live && r && paint(sourceCanvas.current, r.image), () => {})
    }, 120)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [pool, source, settings, view, longEdge])

  // Lifted plates: each ink rendered alone by the engine (with its registration), not a copy of the proof.
  useEffect(() => {
    if (!separated) return
    let live = true
    const edge = Math.round(longEdge * (phone ? 0.6 : 0.7))
    Promise.all(([0, 1] as const).map((k) =>
      pool.render(source, settings, k === 0 ? 'ink1' : 'ink2', edge, { lane: k === 0 ? 'plate1' : 'plate2' }).then((r) => {
        if (live && r) paint(plateCanvas[k].current, r.image)
        return !!r
      }),
    )).then((ok) => live && ok.every(Boolean) && setPlatesReady(true), () => {})
    return () => {
      live = false
    }
    // plateCanvas refs are stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [separated, pool, source, settings, longEdge, phone])
  useEffect(() => {
    if (!separated) setPlatesReady(false)
  }, [separated])

  // A plate returned to exact register snaps visibly (a UI cue only; never in the print).
  const reg = settings.registration[activePlate]
  const registered = reg.dx === 0 && reg.dy === 0 && reg.rotate === 0
  const wasRegistered = useRef(registered)
  useEffect(() => {
    if (registered && !wasRegistered.current) {
      setSnap(true)
      const t = window.setTimeout(() => setSnap(false), 320)
      wasRegistered.current = registered
      return () => window.clearTimeout(t)
    }
    wasRegistered.current = registered
  }, [registered])

  const canDrag = tool === 'move' && (view === 'print' || view === 'compare' || (view === 'ink1' && activePlate === 0) || (view === 'ink2' && activePlate === 1))

  // ── pointer handling ────────────────────────────────────────────────────
  const endDrag = () => {
    if (!drag.current) return
    drag.current = null
    setReadout(null)
    onCommit()
    dismissHint()
  }

  const loupeAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setLoupe({ x: e.clientX - r.left, y: e.clientY - r.top, lifted: e.pointerType === 'touch' })
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.add(e.pointerId)
    // A second finger means a pinch, not a drag: put the plate back where it started, with no undo step.
    if (pointers.current.size > 1) {
      const d = drag.current
      if (d) {
        drag.current = null
        setReadout(null)
        onPreview(withRegistration(settings, activePlate, d.start))
        onCommit()
      }
      return
    }
    if (e.button !== 0) return
    if (tool === 'loupe') {
      capture(e.currentTarget, e.pointerId)
      loupeAt(e)
      return
    }
    if (!canDrag) return
    capture(e.currentTarget, e.pointerId)
    const r = e.currentTarget.getBoundingClientRect()
    drag.current = { x: e.clientX, y: e.clientY, start: reg, pointerId: e.pointerId, mmPerPx: SHEET_LONG_EDGE_MM / Math.max(r.width, r.height), left: r.left, top: r.top }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (tool === 'loupe') {
      if (e.pointerType === 'mouse' || e.currentTarget.hasPointerCapture(e.pointerId)) loupeAt(e)
      return
    }
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = clampOffset(d.start.dx + (e.clientX - d.x) * d.mmPerPx)
    const dy = clampOffset(d.start.dy + (e.clientY - d.y) * d.mmPerPx)
    onPreview(withRegistration(settings, activePlate, { ...d.start, dx, dy }))
    setReadout({ x: e.clientX - d.left, y: e.clientY - d.top, dx, dy })
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (drag.current?.pointerId === e.pointerId) endDrag()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : 0.1
    const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key]
    if (!delta) return
    e.preventDefault()
    if (tool === 'loupe') {
      // The loupe moves 1 mm (Shift: 5 mm) across the sheet.
      const px = ((e.shiftKey ? 5 : 1) * cssLong) / SHEET_LONG_EDGE_MM
      setLoupe((l) => {
        const cur = l ?? { x: cssW / 2, y: cssH / 2, lifted: false }
        return { x: Math.min(cssW, Math.max(0, cur.x + delta[0] * px)), y: Math.min(cssH, Math.max(0, cur.y + delta[1] * px)), lifted: false }
      })
      return
    }
    if (!canDrag) return
    // Preview while the key is held; commit on keyup — one undo step per press-and-hold.
    onPreview(withRegistration(settings, activePlate, { ...reg, dx: clampOffset(reg.dx + delta[0] * step), dy: clampOffset(reg.dy + delta[1] * step) }))
  }

  const ink = settings.inks[activePlate]
  const label = view === 'compare' ? 'Split: source and print' : view === 'print' ? 'Print' : view === 'source' ? 'Source' : `Plate ${view === 'ink1' ? 1 : 2} alone`
  const instructions = tool === 'loupe'
    ? 'Loupe on: move the pointer or use the arrow keys to inspect the 300 dpi print.'
    : canDrag ? `Drag or use arrow keys to move plate ${activePlate + 1} (${ink.name}); now ${reg.dx.toFixed(2)} by ${reg.dy.toFixed(2)} millimetres.` : ''

  return (
    <div ref={stage} className={`stage${phone ? ' stage--phone' : ''}`}>
      <div className={`sheet-wrap${separated ? ' is-separated' : ''}${readout ? ' is-dragging' : ''}${snap ? ' is-snapping' : ''}`}
        style={{ width: cssW, height: cssH, marginRight: phone ? 0 : TAB_ROOM_SIDE - 16, marginTop: phone ? TAB_ROOM_TOP - 12 : 0, '--active-ink': ink.color } as React.CSSProperties}>
        <PlateTabs settings={settings} activePlate={activePlate} onSelect={selectPlate} lifted={!!readout} phone={phone} />

        <div
          className={`sheet${canDrag ? ' sheet--draggable' : ''}${tool === 'loupe' ? ' sheet--loupe' : ''}`}
          tabIndex={0}
          role="application"
          aria-roledescription="print"
          aria-label={`${label}. ${instructions}`}
          data-testid="sheet"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onPointerLeave={(e) => tool === 'loupe' && e.pointerType === 'mouse' && setLoupe(null)}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => e.key.startsWith('Arrow') && tool === 'move' && (onCommit(), dismissHint())}
          onBlur={onCommit}
        >
          <canvas ref={canvas} className="sheet__canvas" data-testid="proof" />
          {view === 'compare' && (
            <>
              <canvas ref={sourceCanvas} className="sheet__canvas sheet__canvas--source" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} aria-hidden="true" />
              <SplitHandle value={split} onChange={setSplit} />
            </>
          )}
          {readout && (
            <span className="readout mono" aria-hidden="true" style={{ left: readout.x, top: readout.y }}>
              <b>0{activePlate + 1}</b> x {signed(readout.dx)} · y {signed(readout.dy)} mm
            </span>
          )}
          {tool === 'loupe' && loupe && (
            <Loupe pool={pool} source={source} settings={settings} mode={mode} point={loupe} sheetCss={{ w: cssW, h: cssH }} scale={loupeScale} dpr={dpr} />
          )}
          {busy && <div className="sheet__busy" role="presentation"><span>{busy}</span></div>}
        </div>

        <div className="fan" aria-hidden={!separated}>
          {([0, 1] as const).map((k) => (
            <figure key={k} className={`fan__plate fan__plate--${k + 1}${platesReady ? ' is-ready' : ''}`}>
              <canvas ref={plateCanvas[k]} />
              <figcaption><span className="mono">0{k + 1}</span> {settings.inks[k].name} · {settings.screen.angles[k]}°</figcaption>
            </figure>
          ))}
          {separated && !platesReady && <p className="fan__pulling">Pulling the plates…</p>}
        </div>
      </div>
      <p className="visually-hidden" aria-live="polite">
        Plate {activePlate + 1} offset {reg.dx.toFixed(2)} by {reg.dy.toFixed(2)} millimetres
      </p>
    </div>
  )
}

/** The split wipe's handle, on the sheet itself: drag it, or focus it and use the arrow keys. */
function SplitHandle({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(100, Math.max(0, Math.round(v))))
  return (
    <div className="split" style={{ left: `${value}%` }}>
      <span className="split__label split__label--l mono">Source</span>
      <span className="split__label split__label--r mono">Print</span>
      <div
        className="split__grip"
        role="slider"
        tabIndex={0}
        aria-label="Comparison position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value}% source`}
        onPointerDown={(e) => {
          e.stopPropagation()
          capture(e.currentTarget, e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
          const sheet = e.currentTarget.closest('.sheet')!.getBoundingClientRect()
          set(((e.clientX - sheet.left) / sheet.width) * 100)
        }}
        onKeyDown={(e) => {
          const d = { ArrowLeft: -2, ArrowDown: -2, ArrowRight: 2, ArrowUp: 2, PageDown: -10, PageUp: 10 }[e.key]
          if (e.key === 'Home') set(0)
          else if (e.key === 'End') set(100)
          else if (d === undefined) return
          else set(value + d * (e.shiftKey ? 5 : 1))
          e.preventDefault()
          e.stopPropagation()
        }}
      />
    </div>
  )
}
