import { useEffect, useRef, useState } from 'react'
import type { Edition } from '../state/useEdition'
import { sanitizeName } from '../state/document'

interface TopBarProps {
  edition: Edition
  status: { busy: boolean; ms?: number; size?: [number, number]; error?: string }
  onOpenImage: (file: File) => void
  onOpenProject: (file: File) => void
  onExport: () => void
}

export function TopBar({ edition, status, onOpenImage, onOpenProject, onExport }: TopBarProps) {
  const { doc, actions, canUndo, canRedo, save, source } = edition
  const [name, setName] = useState(doc.name)
  useEffect(() => setName(doc.name), [doc.name])
  const imageInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)

  const saveText = save.kind === 'saved' ? 'Saved' : save.kind === 'saving' ? 'Saving…' : save.kind === 'error' ? `Not saved — ${save.message}` : ''

  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">Edition</span>
        <span className="brand__note">two-ink print studio</span>
      </div>
      <div className="topbar__doc">
        <label htmlFor="doc-name" className="visually-hidden">Print title</label>
        <input id="doc-name" className="topbar__name" value={name} maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (sanitizeName(name) !== doc.name ? actions.rename(sanitizeName(name)) : setName(doc.name))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <span className="topbar__meta mono" role="status" data-testid="proof-status">
          {source.status === 'ready' ? source.label : source.status === 'loading' ? source.message : 'No image'}
          {' · '}
          {status.error ? `proof failed: ${status.error}` : status.busy ? 'proofing…' : status.ms !== undefined ? `proofed in ${Math.round(status.ms)} ms` : ''}
          {saveText && ` · ${saveText}`}
        </span>
      </div>
      <div className="topbar__actions">
        <button type="button" className="secondary-button" onClick={() => imageInput.current?.click()}>Open image…</button>
        <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="image-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onOpenImage(f)
            e.target.value = ''
          }} />
        <button type="button" className="text-button" onClick={() => projectInput.current?.click()}>Open project…</button>
        <input ref={projectInput} type="file" accept=".edition,.json,application/json,application/zip" hidden data-testid="project-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onOpenProject(f)
            e.target.value = ''
          }} />
        <button type="button" className="text-button" onClick={actions.useSample}>Sample</button>
        <span className="topbar__sep" aria-hidden="true" />
        <button type="button" className="icon-button" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={actions.undo}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5 3 9l4 4M3.5 9H12a5 5 0 0 1 0 10h-2" /></svg>
        </button>
        <button type="button" className="icon-button" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={actions.redo}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m13 5 4 4-4 4M16.5 9H8a5 5 0 0 0 0 10h2" /></svg>
        </button>
        <button type="button" className="primary-button" onClick={onExport} disabled={source.status !== 'ready'}>Export</button>
      </div>
    </header>
  )
}
