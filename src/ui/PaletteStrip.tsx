import { PALETTES, settingsFromPalette } from '../state/document'
import type { PrintSettings } from '../engine/types'

export function PaletteStrip({ settings, onPush }: { settings: PrintSettings; onPush: (s: PrintSettings) => void }) {
  return (
    <div className="palettes" role="group" aria-label="Ink palettes">
      {PALETTES.map((p) => {
        const on = p.inks[0].color === settings.inks[0].color && p.inks[1].color === settings.inks[1].color
        return (
          <button key={p.id} type="button" className="palette" aria-pressed={on} onClick={() => onPush(settingsFromPalette(p, settings))}>
            <span className="palette__inks" aria-hidden="true">
              <span style={{ background: p.inks[0].color }} />
              <span style={{ background: p.inks[1].color }} />
            </span>
            <span className="palette__name">{p.name}</span>
          </button>
        )
      })}
    </div>
  )
}
