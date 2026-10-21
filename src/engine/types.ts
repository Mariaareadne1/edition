/**
 * Everything the renderer needs, as plain serialisable data. The document
 * model (state/document.ts) stores exactly this plus naming and the source ref.
 */

export interface Ink {
  /** honest descriptive name — these are screen approximations, not press inks */
  name: string
  color: string // #rrggbb
  /** 0–1 density of a solid; 1 = fully opaque film of the ink colour */
  opacity: number
  enabled: boolean
}

export interface Separation {
  /** tone curve contrast around mid grey, 0.5–2 */
  contrast: number
  /** shifts the key plate lighter (−) or darker (+), −0.5–0.5 */
  density: number
  /** strength of the accent plate, 0–2 */
  accent: number
  /** how much the key plate gives way where the accent plate takes over, 0–1 */
  balance: number
}

export interface Screen {
  /** halftone cells across the sheet's long edge, 40–260 */
  ruling: number
  /** screen angles in degrees, one per ink */
  angles: [number, number]
}

export interface Registration {
  /** offset in millimetres on the printed sheet */
  dx: number
  dy: number
  /** degrees, small */
  rotate: number
}

export interface Paper {
  color: string // #rrggbb
  /** paper tooth, 0–1 */
  grain: number
  /** mottle in ink laydown, 0–1 */
  inkTexture: number
  /** seed for the deterministic grain field */
  seed: number
  /** margin as a fraction of the long edge, 0–0.2 */
  margin: number
  /** print registration marks in the margin */
  marks: boolean
}

export interface PrintSettings {
  inks: [Ink, Ink]
  separation: Separation
  screen: Screen
  registration: [Registration, Registration]
  paper: Paper
}

/** Physical long edge of the sheet; offsets are in millimetres relative to this. */
export const SHEET_LONG_EDGE_MM = 297

export type View = 'print' | 'ink1' | 'ink2' | 'source'
