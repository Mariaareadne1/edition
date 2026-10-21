import type { PrintSettings } from '../engine/types'
import { SHEET_LONG_EDGE_MM } from '../engine/types'
import { LIMITS, PAPER_TONES } from '../state/document'
import { Field } from './Field'

interface InspectorProps {
  settings: PrintSettings
  onPreview: (s: PrintSettings) => void
  onPush: (s: PrintSettings) => void
  onCommit: () => void
}

export function Inspector({ settings: s, onPreview, onPush, onCommit }: InspectorProps) {
  const sep = (patch: Partial<PrintSettings['separation']>) => ({ ...s, separation: { ...s.separation, ...patch } })
  const paper = (patch: Partial<PrintSettings['paper']>) => ({ ...s, paper: { ...s.paper, ...patch } })
  const lpi = s.screen.ruling / (SHEET_LONG_EDGE_MM / 25.4)
  return (
    <aside className="inspector" aria-label="Print controls">
      <section className="inspector__section">
        <h2 className="panel-heading">Separation</h2>
        <Field label="Contrast" precision={2} step={0.01} min={LIMITS.contrast.min} max={LIMITS.contrast.max} value={s.separation.contrast}
          hint="Steepens the key plate’s tone curve" onPreview={(v) => onPreview(sep({ contrast: v }))} onCommit={onCommit} />
        <Field label="Key density" precision={2} step={0.01} min={LIMITS.density.min} max={LIMITS.density.max} value={s.separation.density}
          hint="Lighter (−) or heavier (+) key ink" onPreview={(v) => onPreview(sep({ density: v }))} onCommit={onCommit} />
        <Field label="Accent pickup" precision={2} step={0.01} min={LIMITS.accent.min} max={LIMITS.accent.max} value={s.separation.accent}
          hint="How readily colour near ink 2’s hue goes to the accent plate" onPreview={(v) => onPreview(sep({ accent: v }))} onCommit={onCommit} />
        <Field label="Key gives way" precision={2} step={0.01} min={LIMITS.balance.min} max={LIMITS.balance.max} value={s.separation.balance}
          hint="Thins the key plate under the accent so colour stays clean" onPreview={(v) => onPreview(sep({ balance: v }))} onCommit={onCommit} />
      </section>

      <section className="inspector__section">
        <h2 className="panel-heading">Screen</h2>
        <Field label="Ruling" unit="cells" precision={0} step={1} min={LIMITS.ruling.min} max={LIMITS.ruling.max} value={s.screen.ruling}
          hint={`Across the long edge · ${lpi.toFixed(1)} lines per inch on a ${SHEET_LONG_EDGE_MM} mm sheet`}
          onPreview={(v) => onPreview({ ...s, screen: { ...s.screen, ruling: v } })} onCommit={onCommit} />
      </section>

      <section className="inspector__section">
        <h2 className="panel-heading">Paper</h2>
        <div className="tones" role="group" aria-label="Paper tone">
          {PAPER_TONES.map((t) => (
            <button key={t.color} type="button" className="tone" aria-pressed={s.paper.color === t.color} onClick={() => onPush(paper({ color: t.color }))}>
              <span className="tone__swatch" style={{ background: t.color }} aria-hidden="true" />
              {t.name}
            </button>
          ))}
          <label className="tone tone--custom">
            <input type="color" value={s.paper.color} onChange={(e) => onPreview(paper({ color: e.target.value }))} onBlur={onCommit} />
            Custom
          </label>
        </div>
        <Field label="Paper tooth" precision={2} step={0.01} min={0} max={1} value={s.paper.grain}
          onPreview={(v) => onPreview(paper({ grain: v }))} onCommit={onCommit} />
        <Field label="Ink mottle" precision={2} step={0.01} min={0} max={1} value={s.paper.inkTexture}
          onPreview={(v) => onPreview(paper({ inkTexture: v }))} onCommit={onCommit} />
        <Field label="Margin" unit="%" precision={1} step={0.5} min={0} max={20} value={s.paper.margin * 100}
          onPreview={(v) => onPreview(paper({ margin: v / 100 }))} onCommit={onCommit} />
        <div className="inspector__row">
          <label className="check">
            <input type="checkbox" checked={s.paper.marks} onChange={(e) => onPush(paper({ marks: e.target.checked }))} />
            Registration marks
          </label>
          <button type="button" className="text-button" onClick={() => onPush(paper({ seed: (s.paper.seed * 7919 + 104729) % 999_983 }))}>
            New grain · <span className="mono">#{s.paper.seed}</span>
          </button>
        </div>
      </section>
    </aside>
  )
}
