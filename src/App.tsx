import { useCallback, useEffect, useState } from 'react'
import { useEdition, slug } from './state/useEdition'
import { RenderPool } from './worker/pool'
import { TopBar } from './ui/TopBar'
import { PlateStack } from './ui/PlateStack'
import { Inspector } from './ui/Inspector'
import { PrintCanvas, type ViewMode, type Zoom } from './ui/PrintCanvas'
import { PaletteStrip } from './ui/PaletteStrip'
import { ExportDialog } from './ui/ExportDialog'
import { ImportError } from './image/import'
import { SchemaError } from './state/document'

const VIEWS: Array<{ id: ViewMode; label: string }> = [
  { id: 'print', label: 'Print' },
  { id: 'ink1', label: 'Ink 1' },
  { id: 'ink2', label: 'Ink 2' },
  { id: 'source', label: 'Source' },
  { id: 'compare', label: 'Compare' },
]

export default function App() {
  const edition = useEdition()
  const { settings, source, actions, notice } = edition
  // Created in an effect so StrictMode's simulated unmount disposes the pool it made.
  const [pool, setPool] = useState<RenderPool | null>(null)
  const [view, setView] = useState<ViewMode>('print')
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [activePlate, setActivePlate] = useState<0 | 1>(1)
  const [status, setStatus] = useState<{ busy: boolean; ms?: number; size?: [number, number]; error?: string }>({ busy: true })
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input[type="text"], dialog')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) actions.redo()
        else actions.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actions])

  const onStatus = useCallback((s: typeof status) => setStatus(s), [])

  return (
    <div
      className={`app${dragOver ? ' is-dropping' : ''}`}
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
      <TopBar edition={edition} status={status} onOpenImage={openImage} onOpenProject={openProject} onExport={() => setExporting(true)} />
      {(notice || busyMessage) && (
        <div className="banner" role={notice ? 'alert' : 'status'}>
          <p>{busyMessage ?? notice}</p>
          {notice && <button type="button" className="text-button" onClick={actions.dismissNotice}>Dismiss</button>}
        </div>
      )}
      <main className="studio">
        <PlateStack settings={settings} activePlate={activePlate} view={view} onActivate={setActivePlate} onView={setView}
          onPreview={actions.preview} onPush={actions.push} onCommit={actions.commit} />
        <section className="press" aria-label="Print">
          <div className="press__bar">
            <div className="views" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" className="view" aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
              ))}
            </div>
            <div className="views" role="group" aria-label="Zoom">
              <button type="button" className="view" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit</button>
              <button type="button" className="view" aria-pressed={zoom === 'detail'} onClick={() => setZoom('detail')}>Loupe</button>
            </div>
          </div>
          {payload && pool ? (
            <PrintCanvas pool={pool} source={payload} settings={settings} view={view} zoom={zoom} activePlate={activePlate}
              onPreview={actions.preview} onPush={actions.push} onCommit={actions.commit} onStatus={onStatus} />
          ) : (
            <div className="desk desk--empty">
              <p>{source.status === 'loading' ? source.message : source.status === 'error' ? source.message : ''}</p>
            </div>
          )}
          <footer className="press__foot">
            <PaletteStrip settings={settings} onPush={actions.push} />
            <p className="press__meta mono">
              {status.size ? `proof ${status.size[0]}×${status.size[1]} px` : ''} · drop a JPEG, PNG or WebP anywhere
            </p>
          </footer>
        </section>
        <Inspector settings={settings} onPreview={actions.preview} onPush={actions.push} onCommit={actions.commit} />
      </main>
      {exporting && payload && (
        <ExportDialog source={payload} settings={settings} baseName={slug(edition.doc.name)}
          onPackage={actions.exportPackageWithImage} onSettings={actions.exportSettings} onClose={() => setExporting(false)} />
      )}
      {dragOver && <div className="dropzone" aria-hidden="true"><p>Drop to open</p></div>}
    </div>
  )
}
