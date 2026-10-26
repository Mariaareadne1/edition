import { useEffect, useRef } from 'react'
import type { Ink, PrintSettings, Registration } from '../engine/types'
import { SHEET_LONG_EDGE_MM } from '../engine/types'
import { LIMITS, PALETTES, PAPER_TONES, settingsFromPalette } from '../state/document'
import type { Studio } from '../state/useStudio'
import { Field } from './Field'
import { useMedia } from './useMedia'

interface InkTrayProps {
  settings: PrintSettings
  studio: Studio
  onPreview: (s: PrintSettings) => void
  onPush: (s: PrintSettings) => void
  onCommit: () => void
}

const ROLE = ['Key · carries tone', 'Accent · carries colour'] as const

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

/**
 * The ink tray: what you reach for while printing — the plate in hand (ink,
 * angle, density, register), the screen ruling and the ink recipes. The
 * separation and the paper fold away in the workshop drawer. On a phone the
 * same tray is a bottom sheet.
 */
export function InkTray({ settings: s, studio, onPreview, onPush, onCommit }: InkTrayProps) {
  const k = studio.state.activePlate
  const { trayOpen, drawerOpen } = studio.state
  const { setTray, setDrawer, selectPlate } = studio.actions
  const phone = useMedia('(max-width: 899px)')
  const ink = s.inks[k]
  const reg = s.registration[k]
  const lpi = s.screen.ruling / (SHEET_LONG_EDGE_MM / 25.4)
  const heading = useRef<HTMLHeadingElement>(null)
  const sep = (patch: Partial<PrintSettings['separation']>) => ({ ...s, separation: { ...s.separation, ...patch } })
  const paper = (patch: Partial<PrintSettings['paper']>) => ({ ...s, paper: { ...s.paper, ...patch } })

  // Phone sheet: focus moves in, Escape and the browser's Back button close it.
  useEffect(() => {
    if (!phone || !trayOpen) return
    heading.current?.focus()
    window.history.pushState({ editionTray: true }, '')
    const onPop = () => setTray(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement).closest('dialog') && window.history.back()
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      if ((window.history.state as { editionTray?: boolean } | null)?.editionTray) window.history.back()
    }
  }, [phone, trayOpen, setTray])

  // Opening the drawer brings its contents into the tray's view.
  const drawer = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!drawerOpen) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    requestAnimationFrame(() => drawer.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }))
  }, [drawerOpen])

  const close = () => {
    setTray(false)
    document.querySelector<HTMLButtonElement>('.rail__adjust')?.focus()
  }

  return (
    <>
    {/* Tapping the table behind the sheet closes it; keyboard and screen-reader users have the × and Escape. */}
    {phone && trayOpen && <div className="scrim" aria-hidden="true" onClick={close} />}
    <aside id="ink-tray" className={`tray${trayOpen ? ' is-open' : ''}`} aria-label="Ink tray"
      style={{ '--plate-ink': ink.color } as React.CSSProperties} hidden={phone && !trayOpen}>
      <header className="tray__head">
        <div className="tray__plates" role="group" aria-label="Plate">
          {([0, 1] as const).map((i) => (
            <button key={i} type="button" className="tray__plate" aria-pressed={i === k} onClick={() => selectPlate(i)}
              style={{ '--swatch': s.inks[i].color } as React.CSSProperties}>
              <span className="mono">0{i + 1}</span>
            </button>
          ))}
        </div>
        <h2 className="tray__title" ref={heading} tabIndex={-1}>
          Plate 0{k + 1}
          <span className="tray__role">{ROLE[k]}</span>
        </h2>
        <button type="button" className="tray__close" aria-label="Close tray" onClick={close}>×</button>
      </header>

      <section className="tray__ink">
        <label className="swatch" title="Ink colour">
          <span className="visually-hidden">Ink {k + 1} colour</span>
          <input type="color" value={ink.color} onChange={(e) => onPreview(patchInk(s, k, { color: e.target.value }))} onBlur={onCommit} />
        </label>
        <div className="tray__ink-text">
          <span className="tray__ink-name">{ink.name}</span>
          <span className="mono tray__ink-hex" title="A screen colour, not a match to any physical press ink">{ink.color.toUpperCase()} · screen colour</span>
        </div>
        <button type="button" className="switch" role="switch" aria-checked={ink.enabled} onClick={() => onPush(patchInk(s, k, { enabled: !ink.enabled }))}>
          <span className="switch__track" aria-hidden="true"><span className="switch__thumb" /></span>
          <span className="switch__label">{ink.enabled ? 'Printing' : 'Off'}<span className="visually-hidden"> ink {k + 1}</span></span>
        </button>
      </section>

      <section className="tray__group">
        <Field label="Screen angle" unit="°" precision={0} step={1} min={LIMITS.angle.min} max={LIMITS.angle.max} value={s.screen.angles[k]}
          onPreview={(v) => onPreview(patchAngle(s, k, v))} onCommit={onCommit} />
        <Field label="Ink density" precision={2} step={0.01} min={0.2} max={1} value={ink.opacity}
          onPreview={(v) => onPreview(patchInk(s, k, { opacity: v }))} onCommit={onCommit} />
      </section>

      <section className="tray__group tray__register" aria-label={`Plate ${k + 1} register`}>
        <h3 className="tray__label">Register <span className="mono">mm on the sheet</span></h3>
        <RegisterPad reg={reg} />
        <div className="tray__register-fields">
          <Field label="Shift X" unit="mm" precision={2} step={0.05} min={LIMITS.offset.min} max={LIMITS.offset.max} value={reg.dx}
            onPreview={(v) => onPreview(patchReg(s, k, { dx: v }))} onCommit={onCommit} />
          <Field label="Shift Y" unit="mm" precision={2} step={0.05} min={LIMITS.offset.min} max={LIMITS.offset.max} value={reg.dy}
            onPreview={(v) => onPreview(patchReg(s, k, { dy: v }))} onCommit={onCommit} />
          <Field label="Skew" unit="°" precision={2} step={0.05} min={LIMITS.rotate.min} max={LIMITS.rotate.max} value={reg.rotate}
            onPreview={(v) => onPreview(patchReg(s, k, { rotate: v }))} onCommit={onCommit} />
        </div>
        <button type="button" className="ink-button" disabled={reg.dx === 0 && reg.dy === 0 && reg.rotate === 0}
          onClick={() => onPush(patchReg(s, k, { dx: 0, dy: 0, rotate: 0 }))}>
          Register plate {k + 1} exactly
        </button>
      </section>

      <section className="tray__group">
        <Field label="Ruling" unit="cells" precision={0} step={1} min={LIMITS.ruling.min} max={LIMITS.ruling.max} value={s.screen.ruling}
          hint={`${lpi.toFixed(1)} lpi across the ${SHEET_LONG_EDGE_MM} mm long edge · both plates`}
          onPreview={(v) => onPreview({ ...s, screen: { ...s.screen, ruling: v } })} onCommit={onCommit} />
      </section>

      <section className="tray__group">
        <h3 className="tray__label">Ink recipes</h3>
        <div className="recipes" role="group" aria-label="Ink palettes">
          {PALETTES.map((p) => {
            const on = p.inks[0].color === s.inks[0].color && p.inks[1].color === s.inks[1].color
            return (
              <button key={p.id} type="button" className="recipe" aria-pressed={on} onClick={() => onPush(settingsFromPalette(p, s))}>
                <span className="recipe__inks" aria-hidden="true">
                  <span style={{ background: p.inks[0].color }} />
                  <span style={{ background: p.inks[1].color }} />
                </span>
                <span className="recipe__name">{p.name}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section ref={drawer} className={`drawer${drawerOpen ? ' is-open' : ''}`}>
        <button type="button" className="drawer__pull" aria-expanded={drawerOpen} aria-controls="workshop" onClick={() => setDrawer(!drawerOpen)}>
          <span className="drawer__title">Workshop drawer</span>
          <span className="drawer__sub mono">separation · paper</span>
          <span className="drawer__caret" aria-hidden="true">{drawerOpen ? '–' : '+'}</span>
        </button>
        {drawerOpen && (
          <div id="workshop" className="drawer__body">
            <h3 className="tray__label">Separation</h3>
            <Field label="Contrast" precision={2} step={0.01} min={LIMITS.contrast.min} max={LIMITS.contrast.max} value={s.separation.contrast}
              hint="Steepens the key plate’s tone curve" onPreview={(v) => onPreview(sep({ contrast: v }))} onCommit={onCommit} />
            <Field label="Key density" precision={2} step={0.01} min={LIMITS.density.min} max={LIMITS.density.max} value={s.separation.density}
              hint="Lighter (−) or heavier (+) key ink" onPreview={(v) => onPreview(sep({ density: v }))} onCommit={onCommit} />
            <Field label="Accent pickup" precision={2} step={0.01} min={LIMITS.accent.min} max={LIMITS.accent.max} value={s.separation.accent}
              hint="How readily colour near ink 2’s hue goes to the accent plate" onPreview={(v) => onPreview(sep({ accent: v }))} onCommit={onCommit} />
            <Field label="Key gives way" precision={2} step={0.01} min={LIMITS.balance.min} max={LIMITS.balance.max} value={s.separation.balance}
              hint="Thins the key plate under the accent so colour stays clean" onPreview={(v) => onPreview(sep({ balance: v }))} onCommit={onCommit} />

            <h3 className="tray__label">Paper</h3>
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
            <div className="drawer__row">
              <label className="check">
                <input type="checkbox" checked={s.paper.marks} onChange={(e) => onPush(paper({ marks: e.target.checked }))} />
                Registration marks
              </label>
              <button type="button" className="text-button" onClick={() => onPush(paper({ seed: (s.paper.seed * 7919 + 104729) % 999_983 }))}>
                New grain · <span className="mono">#{s.paper.seed}</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </aside>
    </>
  )
}

/**
 * The plate's offset drawn to scale against the ±6 mm range: a registration
 * target with the plate's own mark where it now lands. Display only — the
 * sheet is where you move it.
 */
function RegisterPad({ reg }: { reg: Registration }) {
  const R = LIMITS.offset.max
  const x = 50 + (reg.dx / R) * 44
  const y = 50 + (reg.dy / R) * 44
  return (
    <svg className="pad" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="6" y="6" width="88" height="88" className="pad__frame" />
      <path d="M50 6v88M6 50h88" className="pad__axis" />
      <circle cx="50" cy="50" r="9" className="pad__home" />
      <g transform={`translate(${x} ${y}) rotate(${reg.rotate * 10})`} className="pad__plate">
        <circle r="9" />
        <path d="M-14 0h28M0 -14v28" />
      </g>
    </svg>
  )
}
