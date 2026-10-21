import { useEffect, useRef, useState } from 'react'
import { zipSync } from 'fflate'
import { sheetLayout } from '../engine/render'
import type { PrintSettings } from '../engine/types'
import { runExport, type ExportJob } from '../worker/pool'
import type { ExportOutput, SourcePayload } from '../worker/protocol'
import { download } from './download'

const SIZES = [
  { id: 'a4-300', label: 'A4 · 300 dpi', longEdge: 3508 },
  { id: 'a4-150', label: 'A4 · 150 dpi', longEdge: 1754 },
  { id: 'screen', label: 'Screen · 2400 px', longEdge: 2400 },
] as const

const FILE_NAMES: Record<ExportOutput, string> = { print: 'print-composite.png', film1: 'ink-1.png', film2: 'ink-2.png' }
const DESCRIPTIONS: Record<ExportOutput, string> = {
  print: 'Both inks on paper, as previewed',
  film1: 'Ink 1 film — black is ink, registered',
  film2: 'Ink 2 film — black is ink, registered',
}

interface Result {
  output: ExportOutput
  blob: Blob
  width: number
  height: number
}

interface ExportDialogProps {
  source: SourcePayload
  settings: PrintSettings
  baseName: string
  onPackage: () => Promise<{ name: string; data: Uint8Array }>
  onSettings: () => { name: string; data: Uint8Array }
  onClose: () => void
}

export function ExportDialog({ source, settings, baseName, onPackage, onSettings, onClose }: ExportDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [size, setSize] = useState<(typeof SIZES)[number]['id']>('a4-300')
  const [outputs, setOutputs] = useState<Record<ExportOutput, boolean>>({ print: true, film1: true, film2: true })
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [error, setError] = useState<string | null>(null)
  const job = useRef<ExportJob | null>(null)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => job.current?.cancel()
  }, [])

  const chosen = SIZES.find((s) => s.id === size)!
  const layout = sheetLayout(source.width, source.height, chosen.longEdge, settings.paper.margin)
  const selected = (Object.keys(outputs) as ExportOutput[]).filter((k) => outputs[k])
  const mm = (px: number) => ((px / layout.scale) * 297).toFixed(0)

  const start = async () => {
    setError(null)
    setResults([])
    setProgress({ done: 0, total: 1, stage: 'starting' })
    job.current = runExport(source, settings, chosen.longEdge, selected, (done, total, stage) => setProgress({ done, total, stage }))
    try {
      setResults(await job.current.promise)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setProgress(null)
      job.current = null
    }
  }

  const prefix = baseName ? `${baseName}-` : ''

  return (
    <dialog ref={dialog} className="export" aria-labelledby="export-title" onClose={onClose}>
      <header className="export__head">
        <div>
          <p className="eyebrow">Pull the edition</p>
          <h2 id="export-title" className="export__title">Export</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={() => dialog.current?.close()}>×</button>
      </header>

      <fieldset className="export__group">
        <legend>Size</legend>
        {SIZES.map((s) => (
          <label key={s.id} className={`option${size === s.id ? ' is-on' : ''}`}>
            <input type="radio" name="size" value={s.id} checked={size === s.id} onChange={() => setSize(s.id)} disabled={!!progress} />
            {s.label}
          </label>
        ))}
        <p className="export__readout mono" data-testid="export-size">
          {layout.width} × {layout.height} px · {mm(layout.width)} × {mm(layout.height)} mm
        </p>
      </fieldset>

      <fieldset className="export__group">
        <legend>Files</legend>
        {(Object.keys(FILE_NAMES) as ExportOutput[]).map((o) => (
          <label key={o} className="check">
            <input type="checkbox" checked={outputs[o]} disabled={!!progress} onChange={(e) => setOutputs({ ...outputs, [o]: e.target.checked })} />
            <span className="mono">{prefix}{FILE_NAMES[o]}</span>
            <span className="muted"> — {DESCRIPTIONS[o]}</span>
          </label>
        ))}
      </fieldset>

      <div className="export__run">
        {progress ? (
          <>
            <progress max={progress.total} value={progress.done} aria-label="Export progress" />
            <span className="mono muted">{progress.stage}…</span>
            <button type="button" className="secondary-button" onClick={() => job.current?.cancel()}>Cancel</button>
          </>
        ) : (
          <button type="button" className="primary-button" disabled={selected.length === 0} onClick={start}>
            Render {selected.length} file{selected.length === 1 ? '' : 's'} at full size
          </button>
        )}
      </div>
      {error && <p className="export__error" role="alert">{error}</p>}

      {results.length > 0 && (
        <ul className="export__results" aria-label="Rendered files">
          {results.map((r) => (
            <li key={r.output}>
              <span className="mono">{prefix}{FILE_NAMES[r.output]}</span>
              <span className="muted mono">{r.width}×{r.height} · {(r.blob.size / 1e6).toFixed(1)} MB</span>
              <button type="button" className="secondary-button" onClick={() => download(prefix + FILE_NAMES[r.output], r.blob)}>Download</button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="primary-button"
              onClick={async () => {
                const entries: Record<string, Uint8Array> = {}
                for (const r of results) entries[prefix + FILE_NAMES[r.output]] = new Uint8Array(await r.blob.arrayBuffer())
                const pkg = await onPackage()
                entries[pkg.name] = pkg.data
                download(`${baseName || 'edition'}.zip`, zipSync(entries, { level: 0 }), 'application/zip')
              }}
            >
              Download all + project (.zip)
            </button>
          </li>
        </ul>
      )}

      <footer className="export__foot">
        <span className="muted">Project files:</span>
        <button type="button" className="text-button" onClick={async () => {
          const pkg = await onPackage()
          download(pkg.name, pkg.data, 'application/zip')
        }}>
          Save .edition (settings + original image)
        </button>
        <button type="button" className="text-button" onClick={() => {
          const s = onSettings()
          download(s.name, s.data, 'application/json')
        }}>
          Settings only (.json)
        </button>
      </footer>
    </dialog>
  )
}
