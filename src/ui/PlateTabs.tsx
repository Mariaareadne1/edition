import { hexToRgb } from '../engine/color'
import type { PrintSettings } from '../engine/types'

/** Black or paper-white lettering, whichever reads on the ink. */
function letterOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.2 ? '#1a1612' : '#fbf6ec'
}

interface PlateTabsProps {
  settings: PrintSettings
  activePlate: 0 | 1
  onSelect: (k: 0 | 1) => void
  /** the plate in hand is being dragged */
  lifted: boolean
  phone: boolean
}

/**
 * The two plates as index tabs tucked under the sheet's edge, in their own
 * inks. The plate in hand stands proud; it is the one a drag will move.
 */
export function PlateTabs({ settings, activePlate, onSelect, lifted, phone }: PlateTabsProps) {
  return (
    <div className={`tabs${phone ? ' tabs--top' : ''}`} role="group" aria-label="Plate in hand">
      {([0, 1] as const).map((k) => {
        const ink = settings.inks[k]
        const reg = settings.registration[k]
        return (
          <button
            key={k}
            type="button"
            className={`tab${k === activePlate ? ' is-active' : ''}${k === activePlate && lifted ? ' is-lifted' : ''}${ink.enabled ? '' : ' is-off'}`}
            aria-pressed={k === activePlate}
            aria-label={`Pick up plate ${k + 1}: ${ink.name}${ink.enabled ? '' : ' (not printing)'}`}
            style={{ '--tab-ink': ink.color, '--tab-letter': letterOn(ink.color) } as React.CSSProperties}
            onClick={() => onSelect(k)}
          >
            <span className="tab__no mono">0{k + 1}</span>
            <span className="tab__name">{ink.name}</span>
            <span className="tab__meta mono">{settings.screen.angles[k]}° · {reg.dx.toFixed(1)}/{reg.dy.toFixed(1)}</span>
          </button>
        )
      })}
    </div>
  )
}
