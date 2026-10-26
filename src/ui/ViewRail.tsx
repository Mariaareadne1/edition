import type { KeyboardEvent } from 'react'
import type { PrintSettings } from '../engine/types'
import { VIEWS, type Studio } from '../state/useStudio'

/** Arrow keys move between the buttons of a group (and press them), Home/End jump. */
function rove(e: KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (i < 0) return
  e.preventDefault()
  const n = buttons.length
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + n) % n
  buttons[next]!.focus()
  buttons[next]!.click()
}

/**
 * The views and hand tools. On the desktop table it is the left margin's
 * index; on a phone the same controls dock at the bottom of the screen.
 */
export function ViewRail({ studio, settings }: { studio: Studio; settings: PrintSettings }) {
  const { view, tool, loupeScale, separated, trayOpen } = studio.state
  const a = studio.actions
  return (
    <div className="rail">
      <div className="rail__views" role="group" aria-label="View" onKeyDown={rove}>
        {VIEWS.map((v, i) => (
          <button key={v.id} type="button" className="rail__view" aria-pressed={view === v.id} onClick={() => a.setView(v.id)}
            style={v.id === 'ink1' || v.id === 'ink2' ? { '--swatch': settings.inks[v.id === 'ink1' ? 0 : 1].color } as React.CSSProperties : undefined}>
            <span className="rail__no mono" aria-hidden="true">0{i + 1}</span>
            <span className="rail__label">{v.label}</span>
          </button>
        ))}
      </div>

      <div className="rail__tools" role="group" aria-label="Tools">
        <button type="button" className="rail__tool rail__adjust" aria-expanded={trayOpen} aria-controls="ink-tray" onClick={() => a.setTray(!trayOpen)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h8M15 6h1M4 14h2M9 14h7" /><circle cx="13.5" cy="6" r="1.8" /><circle cx="7.5" cy="14" r="1.8" /></svg>
          Adjust
        </button>
        <button type="button" className="rail__tool" aria-pressed={tool === 'loupe'} onClick={a.toggleLoupe} title="Loupe (L)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5" /><path d="m12.2 12.2 4.3 4.3" /></svg>
          Loupe
        </button>
        <button type="button" className="rail__tool" aria-pressed={separated} title="Hold to lift the plates apart (or hold S)"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            a.setSeparated(true)
          }}
          onPointerUp={() => a.setSeparated(false)}
          onPointerCancel={() => a.setSeparated(false)}
          onLostPointerCapture={() => a.setSeparated(false)}
          // Keyboard and assistive-tech activation (a click with no pointer press) toggles instead of holding.
          onClick={(e) => e.detail === 0 && a.setSeparated(!separated)}
          onBlur={() => a.setSeparated(false)}
          onContextMenu={(e) => e.preventDefault()}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="5" width="9" height="11" transform="rotate(-6 7.5 10.5)" /><rect x="8" y="4" width="9" height="11" transform="rotate(6 12.5 9.5)" /></svg>
          Separate
        </button>
        {tool === 'loupe' && (
          <span className="rail__scale" role="group" aria-label="Loupe scale">
            {([1, 2] as const).map((s) => (
              <button key={s} type="button" aria-pressed={loupeScale === s} onClick={() => a.setLoupeScale(s)}
                title={s === 1 ? 'One exported pixel per screen pixel' : 'Each exported pixel shown 2× larger'}>
                {s === 1 ? '1:1' : '2:1'}
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}
