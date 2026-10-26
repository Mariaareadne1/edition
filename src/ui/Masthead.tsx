import { useEffect, useRef, useState } from 'react'
import type { Edition } from '../state/useEdition'
import { download } from './download'

interface MastheadProps {
  edition: Edition
  onOpenImage: (file: File) => void
  onOpenProject: (file: File) => void
  onExport: () => void
}

export function Masthead({ edition, onOpenImage, onOpenProject, onExport }: MastheadProps) {
  const { actions, canUndo, canRedo, source } = edition
  const imageInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close the Open menu on outside click or Escape, returning focus to its button.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenu(false)
      menuRef.current?.querySelector<HTMLButtonElement>('.masthead__open')?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const choose = (fn: () => void) => () => {
    setMenu(false)
    fn()
  }

  return (
    <header className="masthead">
      <div className="mark" aria-label="Edition, print room">
        <span className="mark__word">Edition</span>
        <span className="mark__slash" aria-hidden="true">/</span>
        <span className="mark__room">Print room</span>
        <span className="mark__no mono">01 / two inks</span>
      </div>

      <nav className="masthead__tools" aria-label="Project">
        <div className="menu" ref={menuRef}>
          <button type="button" className="tool-button masthead__open" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            Open<span aria-hidden="true" className="tool-button__caret">▾</span>
          </button>
          {menu && (
            <ul className="menu__list" role="menu">
              <li role="none"><button type="button" role="menuitem" autoFocus onClick={choose(() => imageInput.current?.click())}>Image…<span className="mono">JPEG · PNG · WebP</span></button></li>
              <li role="none"><button type="button" role="menuitem" onClick={choose(() => projectInput.current?.click())}>Project…<span className="mono">.edition · .json</span></button></li>
              <li role="none"><button type="button" role="menuitem" onClick={choose(actions.useSample)}>Sample<span className="mono">Harbour, dusk</span></button></li>
            </ul>
          )}
        </div>
        <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="image-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onOpenImage(f)
            e.target.value = ''
          }} />
        <input ref={projectInput} type="file" accept=".edition,.json,application/json,application/zip" hidden data-testid="project-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onOpenProject(f)
            e.target.value = ''
          }} />
        <button type="button" className="tool-button masthead__save" title="Download this print as an .edition project (settings + original image)"
          disabled={source.status !== 'ready'}
          onClick={async () => {
            const pkg = await actions.exportPackageWithImage()
            download(pkg.name, pkg.data, 'application/zip')
          }}>
          Save
        </button>
        <span className="masthead__rule" aria-hidden="true" />
        <button type="button" className="tool-button tool-button--icon" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={actions.undo}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5 3 9l4 4M3.5 9H12a5 5 0 0 1 0 10h-2" /></svg>
        </button>
        <button type="button" className="tool-button tool-button--icon" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={actions.redo}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m13 5 4 4-4 4M16.5 9H8a5 5 0 0 0 0 10h2" /></svg>
        </button>
        <button type="button" className="pull-button" onClick={onExport} disabled={source.status !== 'ready'}>Export</button>
      </nav>
    </header>
  )
}
