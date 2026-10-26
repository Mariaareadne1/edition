import { sheetLayout } from '../engine/render'
import { SHEET_LONG_EDGE_MM } from '../engine/types'
import type { Edition } from '../state/useEdition'
import { VIEWS, type ViewMode } from '../state/useStudio'
import type { ProofStatus } from './Stage'

interface StatusStripProps {
  edition: Edition
  status: ProofStatus
  view: ViewMode
  activePlate: 0 | 1
  busy: string | null
}

/** Facts about the print on the press, set like a printer's slug line. */
export function StatusStrip({ edition, status, view, activePlate, busy }: StatusStripProps) {
  const { settings, source, save } = edition
  const ready = source.status === 'ready'
  const layout = ready ? sheetLayout(source.payload.width, source.payload.height, 1000, settings.paper.margin) : null
  const mm = (u: number) => Math.round(u * SHEET_LONG_EDGE_MM)
  const proof = status.error ? `proof failed: ${status.error}` : status.busy ? 'proofing…' : status.ms !== undefined ? `proofed in ${Math.round(status.ms)} ms` : ''
  const saveText = save.kind === 'saved' ? 'Saved' : save.kind === 'saving' ? 'Saving…' : save.kind === 'error' ? `Not saved — ${save.message}` : ''
  const [a, b] = settings.inks

  return (
    <footer className="strip">
      <span className="strip__item strip__sheet mono">
        {layout ? `sheet ${mm(layout.sheet.w)} × ${mm(layout.sheet.h)} mm` : 'no sheet'}
        {status.size && <span className="strip__dim"> · proof {status.size[0]}×{status.size[1]} px</span>}
      </span>
      <span className="strip__item strip__inks">
        <i style={{ background: a.color, opacity: a.enabled ? 1 : 0.3 }} aria-hidden="true" />{a.name}
        <span className="strip__x" aria-hidden="true">×</span>
        <i style={{ background: b.color, opacity: b.enabled ? 1 : 0.3 }} aria-hidden="true" />{b.name}
      </span>
      <span className="strip__item strip__mode mono">
        {VIEWS.find((v) => v.id === view)!.label.toLowerCase()} · plate 0{activePlate + 1} in hand
      </span>
      <span className={`strip__item strip__status mono${save.kind === 'error' || status.error ? ' is-error' : ''}`} role="status" data-testid="proof-status">
        <span className="strip__source">{ready ? source.label : source.status === 'loading' ? source.message : 'No image'}</span>
        {' · '}
        <span className={status.busy || busy ? 'is-working' : ''}>{busy ?? proof}</span>
        {saveText && ` · ${saveText}`}
      </span>
    </footer>
  )
}
