import type { Ink, PrintSettings, Registration } from '../engine/types'
import { LIMITS } from '../state/document'
import { Field } from './Field'
import type { ViewMode } from './PrintCanvas'

interface PlateStackProps {
  settings: PrintSettings
  activePlate: 0 | 1
  view: ViewMode
  onActivate: (k: 0 | 1) => void
  onView: (v: ViewMode) => void
  onPreview: (s: PrintSettings) => void
  onPush: (s: PrintSettings) => void
  onCommit: () => void
}

const ROLE = ['Key — tone', 'Accent — colour'] as const

function patchInk(s: PrintSettings, k: 0 | 1, patch: Partial<Ink>): PrintSettings {
  const inks = [...s.inks] as PrintSettings['inks']
  inks[k] = { ...inks[k], ...patch }
  return { ...s, inks }
}

function patchReg(s: PrintSettings, k: 0 | 1, patch: Partial<Registration>): PrintSettings {
  const registration = [...s.registration] as PrintSettings['registration']
  registration[k] = { ...registration[k], ...patch }
  return { ...s, registration }
}

function patchAngle(s: PrintSettings, k: 0 | 1, angle: number): PrintSettings {
  const angles = [...s.screen.angles] as [number, number]
  angles[k] = angle
  return { ...s, screen: { ...s.screen, angles } }
}

export function PlateStack({ settings, activePlate, view, onActivate, onView, onPreview, onPush, onCommit }: PlateStackProps) {
  const k = activePlate
  const reg = settings.registration[k]
  return (
    <aside className="plates" aria-label="Plates">
      <h2 className="panel-heading">Plates</h2>
      <ol className="plates__stack">
        {([0, 1] as const).map((i) => {
          const ink = settings.inks[i]
          const solo = view === (i === 0 ? 'ink1' : 'ink2')
          return (
            <li key={i} className={`plate${i === activePlate ? ' is-active' : ''}${ink.enabled ? '' : ' is-off'}`}>
              <button type="button" className="plate__select" aria-pressed={i === activePlate} onClick={() => onActivate(i)}>
                <span className="plate__number">{i + 1}</span>
                <span className="plate__swatch" style={{ background: ink.color }} aria-hidden="true" />
                <span className="plate__text">
                  <span className="plate__name">{ink.name}</span>
                  <span className="plate__role">{ROLE[i]} · {settings.screen.angles[i]}°</span>
                </span>
              </button>
              <div className="plate__tools">
                <label className="plate__color" title="Ink colour">
                  <span className="visually-hidden">Ink {i + 1} colour</span>
                  <input type="color" value={ink.color} onChange={(e) => onPreview(patchInk(settings, i, { color: e.target.value }))} onBlur={onCommit} />
                </label>
                <button type="button" className="chip" aria-pressed={ink.enabled} onClick={() => onPush(patchInk(settings, i, { enabled: !ink.enabled }))}>
                  {ink.enabled ? 'On' : 'Off'}
                  <span className="visually-hidden"> ink {i + 1}</span>
                </button>
                <button type="button" className="chip" aria-pressed={solo} onClick={() => onView(solo ? 'print' : i === 0 ? 'ink1' : 'ink2')}>
                  Solo<span className="visually-hidden"> ink {i + 1}</span>
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      <section className="plates__registration" aria-label={`Ink ${k + 1} registration`}>
        <div>
          <h3 className="panel-subheading">Ink {k + 1} on press</h3>
          <p className="panel-hint">Drag the print, or focus it and use the arrow keys, to move this plate.</p>
        </div>
        <Field label="Shift X" unit="mm" precision={2} step={0.05} min={LIMITS.offset.min} max={LIMITS.offset.max} value={reg.dx}
          onPreview={(v) => onPreview(patchReg(settings, k, { dx: v }))} onCommit={onCommit} />
        <Field label="Shift Y" unit="mm" precision={2} step={0.05} min={LIMITS.offset.min} max={LIMITS.offset.max} value={reg.dy}
          onPreview={(v) => onPreview(patchReg(settings, k, { dy: v }))} onCommit={onCommit} />
        <Field label="Skew" unit="°" precision={2} step={0.05} min={LIMITS.rotate.min} max={LIMITS.rotate.max} value={reg.rotate}
          onPreview={(v) => onPreview(patchReg(settings, k, { rotate: v }))} onCommit={onCommit} />
        <Field label="Screen angle" unit="°" precision={0} step={1} min={LIMITS.angle.min} max={LIMITS.angle.max} value={settings.screen.angles[k]}
          onPreview={(v) => onPreview(patchAngle(settings, k, v))} onCommit={onCommit} />
        <Field label="Ink density" precision={2} step={0.01} min={0.2} max={1} value={settings.inks[k].opacity}
          onPreview={(v) => onPreview(patchInk(settings, k, { opacity: v }))} onCommit={onCommit} />
        <button type="button" className="text-button" onClick={() => onPush(patchReg(settings, k, { dx: 0, dy: 0, rotate: 0 }))}>
          Register ink {k + 1} exactly
        </button>
      </section>
    </aside>
  )
}
