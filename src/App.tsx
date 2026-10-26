import { useCallback, useEffect, useState } from 'react'
import { useEdition, slug } from './state/useEdition'
import { useStudio } from './state/useStudio'
import { RenderPool } from './worker/pool'
import { Masthead } from './ui/Masthead'
import { ViewRail } from './ui/ViewRail'
import { Stage, type ProofStatus } from './ui/Stage'
import { InkTray } from './ui/InkTray'
import { StatusStrip } from './ui/StatusStrip'
import { ExportDialog } from './ui/ExportDialog'
import { ImportError } from './image/import'
import { SchemaError, sanitizeName } from './state/document'

export default function App() {
  const edition = useEdition()
  const { settings, source, actions, notice } = edition
  const studio = useStudio()
  const { view, activePlate } = studio.state
  // Created in an effect so StrictMode's simulated unmount disposes the pool it made.
  const [pool, setPool] = useState<RenderPool | null>(null)
  const [status, setStatus] = useState<ProofStatus>({ busy: true })
  const [exporting, setExporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [busyMessage, setBusyMessage] = useState<string | null>(null)

  useEffect(() => {
    const p = new RenderPool()
    setPool(p)
    return () => p.dispose()
  }, [])
  const payload = source.status === 'ready' ? source.payload : null

  const openImage = useCallback(async (file: File) => {
    setBusyMessage(`Decoding ${file.name}…`)
    try {
      await actions.importImage(file, file.name)
      actions.setNotice(null)
    } catch (err) {
      actions.setNotice(err instanceof ImportError ? err.message : `Could not open ${file.name}.`)
    } finally {
      setBusyMessage(null)
    }
  }, [actions])

  const openProject = useCallback(async (file: File) => {
    setBusyMessage(`Opening ${file.name}…`)
    try {
      actions.setNotice(await actions.importPackage(file))
    } catch (err) {
      actions.setNotice(err instanceof ImportError || err instanceof SchemaError ? `Could not open ${file.name}: ${err.message}` : `Could not open ${file.name}.`)
    } finally {
      setBusyMessage(null)
    }
  }, [actions])

  // Global keys. Typing in a field or working in a dialog never triggers them.
  const { selectPlate, toggleLoupe, setSeparated } = studio.actions
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('input, textarea, select, dialog, [contenteditable="true"]')
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        if ((e.target as HTMLElement).closest('input[type="text"], textarea, dialog')) return
        e.preventDefault()
        if (e.shiftKey) actions.redo()
        else actions.undo()
        return
      }
      if (mod || e.altKey || typing(e.target)) return
      if (e.key === '1' || e.key === '2') selectPlate(e.key === '1' ? 0 : 1)
      else if (e.key.toLowerCase() === 'l') toggleLoupe()
      else if (e.key.toLowerCase() === 's' && !e.repeat) setSeparated(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 's') setSeparated(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [actions, selectPlate, toggleLoupe, setSeparated])

  const onStatus = useCallback((s: ProofStatus) => setStatus(s), [])

  return (
    <div
      className={`app${dragOver ? ' is-dropping' : ''}`}
      style={{ '--ink-1': settings.inks[0].color, '--ink-2': settings.inks[1].color, '--paper-stock': settings.paper.color } as React.CSSProperties}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (!f) return
        if (/\.(edition|json)$/i.test(f.name)) void openProject(f)
        else void openImage(f)
      }}
    >
      <Masthead edition={edition} onOpenImage={openImage} onOpenProject={openProject} onExport={() => setExporting(true)} />

      {(notice || busyMessage) && (
        <div className={`slip${notice ? ' slip--notice' : ''}`} role={notice ? 'alert' : 'status'}>
          <p>{busyMessage ?? notice}</p>
          {notice && <button type="button" className="slip__dismiss" onClick={actions.dismissNotice}>Dismiss</button>}
        </div>
      )}

      <main className="table">
        <section className="margin" aria-label="Print title and views">
          <Title edition={edition} />
          <ViewRail studio={studio} settings={settings} />
          {studio.state.hint && (
            <p className="hint">
              <span>Drag the print to shift <b style={{ color: `var(--ink-${activePlate + 1})` }}>Plate 0{activePlate + 1}</b>.<span className="hint__keys"> Arrows nudge 0.1 mm, Shift 1 mm.</span></span>
              <button type="button" className="hint__close" onClick={studio.actions.dismissHint} aria-label="Dismiss hint">×</button>
            </p>
          )}
        </section>

        {payload && pool ? (
          <Stage pool={pool} source={payload} settings={settings} studio={studio}
            onPreview={actions.preview} onCommit={actions.commit} onStatus={onStatus} busy={busyMessage} />
        ) : (
          <div className="stage stage--empty">
            <div className="sheet sheet--blank" role="status">
              <p>{source.status === 'loading' ? source.message : source.status === 'error' ? source.message : ''}</p>
            </div>
          </div>
        )}

        <InkTray settings={settings} studio={studio} onPreview={actions.preview} onPush={actions.push} onCommit={actions.commit} />
      </main>

      <StatusStrip edition={edition} status={status} view={view} activePlate={activePlate} busy={busyMessage} />

      {exporting && payload && (
        <ExportDialog source={payload} settings={settings} baseName={slug(edition.doc.name)}
          onPackage={actions.exportPackageWithImage} onSettings={actions.exportSettings} onClose={() => setExporting(false)} />
      )}
      {dragOver && <div className="dropzone" aria-hidden="true"><p>Lay it on the press</p><span>JPEG · PNG · WebP · .edition</span></div>}
    </div>
  )
}

/** The print's title, set large on the table — editable, renames the document. */
function Title({ edition }: { edition: ReturnType<typeof useEdition> }) {
  const { doc, actions, source } = edition
  const [name, setName] = useState(doc.name)
  useEffect(() => setName(doc.name), [doc.name])
  const commit = () => {
    const clean = sanitizeName(name)
    if (clean !== doc.name) actions.rename(clean)
    else setName(doc.name)
  }
  return (
    <div className="title">
      <p className="title__eyebrow">
        <span className="mono">No. 01</span>
        <span>{source.status === 'ready' ? source.label : 'Two-ink print'}</span>
      </p>
      <label htmlFor="doc-name" className="visually-hidden">Print title</label>
      <textarea id="doc-name" className="title__name" value={name} maxLength={60} spellCheck={false} rows={2}
        onChange={(e) => setName(e.target.value.replace(/\n/g, ' '))} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          }
          if (e.key === 'Escape') {
            setName(doc.name)
            e.currentTarget.blur()
          }
        }} />
    </div>
  )
}
