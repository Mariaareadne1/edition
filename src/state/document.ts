import { isHex } from '../engine/color'
import type { Ink, PrintSettings, Registration } from '../engine/types'

export const SCHEMA_VERSION = 1

export type SourceRef =
  | { kind: 'sample'; id: 'harbour' }
  /** an imported image whose original bytes live in IndexedDB under `blobId` */
  | { kind: 'image'; blobId: string; name: string; width: number; height: number; type: string }

export interface EditionDocument {
  version: typeof SCHEMA_VERSION
  id: string
  name: string
  source: SourceRef
  settings: PrintSettings
  updatedAt: number
}

export interface Palette {
  id: string
  name: string
  inks: [Pick<Ink, 'name' | 'color'>, Pick<Ink, 'name' | 'color'>]
  paper: string
}

/** Screen approximations named for what they look like, not proprietary press inks. */
export const PALETTES: Palette[] = [
  { id: 'cobalt-coral', name: 'Cobalt & Coral', inks: [{ name: 'Deep cobalt', color: '#1f3a93' }, { name: 'Warm coral', color: '#f4664a' }], paper: '#f4efe4' },
  { id: 'indigo-ochre', name: 'Indigo & Ochre', inks: [{ name: 'Dark indigo', color: '#2c2a5a' }, { name: 'Ochre', color: '#e0a32e' }], paper: '#f3eee0' },
  { id: 'evergreen-vermilion', name: 'Evergreen & Vermilion', inks: [{ name: 'Evergreen', color: '#1d4a3c' }, { name: 'Vermilion', color: '#e8452c' }], paper: '#f2ede2' },
]

export const PAPER_TONES = [
  { name: 'Natural', color: '#f4efe4' },
  { name: 'Bright white', color: '#fbfbf8' },
  { name: 'Cream', color: '#f1e6cf' },
  { name: 'Newsprint', color: '#e6e1d4' },
]

export const LIMITS = {
  opacity: { min: 0, max: 1 },
  contrast: { min: 0.5, max: 2 },
  density: { min: -0.5, max: 0.5 },
  accent: { min: 0, max: 2 },
  balance: { min: 0, max: 1 },
  ruling: { min: 40, max: 260 },
  angle: { min: 0, max: 90 },
  offset: { min: -6, max: 6 },
  rotate: { min: -3, max: 3 },
  grain: { min: 0, max: 1 },
  inkTexture: { min: 0, max: 1 },
  margin: { min: 0, max: 0.2 },
  seed: { min: 0, max: 999_999 },
} as const

export function settingsFromPalette(p: Palette, base?: PrintSettings): PrintSettings {
  const prev = base ?? DEFAULT_SETTINGS
  return {
    ...prev,
    inks: [
      { ...prev.inks[0], ...p.inks[0] },
      { ...prev.inks[1], ...p.inks[1] },
    ],
    paper: { ...prev.paper, color: p.paper },
  }
}

const REG0: Registration = { dx: 0, dy: 0, rotate: 0 }

export const DEFAULT_SETTINGS: PrintSettings = {
  inks: [
    { name: 'Deep cobalt', color: '#1f3a93', opacity: 0.96, enabled: true },
    { name: 'Warm coral', color: '#f4664a', opacity: 0.92, enabled: true },
  ],
  separation: { contrast: 1.35, density: 0.04, accent: 1.3, balance: 0.7 },
  screen: { ruling: 150, angles: [15, 75] },
  registration: [REG0, { dx: 0.6, dy: -0.4, rotate: 0.3 }],
  paper: { color: '#f4efe4', grain: 0.35, inkTexture: 0.2, seed: 1907, margin: 0.07, marks: true },
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `d-${Date.now().toString(36)}`
}

export function createDocument(source: SourceRef = { kind: 'sample', id: 'harbour' }, name = 'Harbour, dusk'): EditionDocument {
  return { version: SCHEMA_VERSION, id: newId(), name, source, settings: DEFAULT_SETTINGS, updatedAt: Date.now() }
}

export function sanitizeName(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  const clean = (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return clean || 'Untitled print'
}

// ── validation ─────────────────────────────────────────────────────────────

export class SchemaError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function num(v: unknown, path: string, lim: { min: number; max: number }): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SchemaError(`${path} must be a number`)
  return Math.min(lim.max, Math.max(lim.min, v))
}

function hex(v: unknown, path: string): string {
  if (!isHex(v)) throw new SchemaError(`${path} must be a #rrggbb colour`)
  return v.toLowerCase()
}

function readInk(v: unknown, path: string): Ink {
  if (!isRecord(v)) throw new SchemaError(`${path} must be an object`)
  if (typeof v.enabled !== 'boolean') throw new SchemaError(`${path}.enabled must be true or false`)
  return { name: sanitizeName(v.name), color: hex(v.color, `${path}.color`), opacity: num(v.opacity, `${path}.opacity`, LIMITS.opacity), enabled: v.enabled }
}

function readReg(v: unknown, path: string): Registration {
  if (!isRecord(v)) throw new SchemaError(`${path} must be an object`)
  return { dx: num(v.dx, `${path}.dx`, LIMITS.offset), dy: num(v.dy, `${path}.dy`, LIMITS.offset), rotate: num(v.rotate, `${path}.rotate`, LIMITS.rotate) }
}

export function readSettings(v: unknown): PrintSettings {
  if (!isRecord(v)) throw new SchemaError('settings must be an object')
  const { inks, separation: s, screen, registration, paper } = v
  if (!Array.isArray(inks) || inks.length !== 2) throw new SchemaError('settings.inks must list two inks')
  if (!isRecord(s) || !isRecord(screen) || !isRecord(paper)) throw new SchemaError('settings is missing separation, screen or paper')
  if (!Array.isArray(registration) || registration.length !== 2) throw new SchemaError('settings.registration must list two plates')
  if (!Array.isArray(screen.angles) || screen.angles.length !== 2) throw new SchemaError('settings.screen.angles must list two angles')
  if (typeof paper.marks !== 'boolean') throw new SchemaError('settings.paper.marks must be true or false')
  return {
    inks: [readInk(inks[0], 'inks[0]'), readInk(inks[1], 'inks[1]')],
    separation: {
      contrast: num(s.contrast, 'separation.contrast', LIMITS.contrast),
      density: num(s.density, 'separation.density', LIMITS.density),
      accent: num(s.accent, 'separation.accent', LIMITS.accent),
      balance: num(s.balance, 'separation.balance', LIMITS.balance),
    },
    screen: {
      ruling: num(screen.ruling, 'screen.ruling', LIMITS.ruling),
      angles: [num(screen.angles[0], 'screen.angles[0]', LIMITS.angle), num(screen.angles[1], 'screen.angles[1]', LIMITS.angle)],
    },
    registration: [readReg(registration[0], 'registration[0]'), readReg(registration[1], 'registration[1]')],
    paper: {
      color: hex(paper.color, 'paper.color'),
      grain: num(paper.grain, 'paper.grain', LIMITS.grain),
      inkTexture: num(paper.inkTexture, 'paper.inkTexture', LIMITS.inkTexture),
      seed: Math.round(num(paper.seed, 'paper.seed', LIMITS.seed)),
      margin: num(paper.margin, 'paper.margin', LIMITS.margin),
      marks: paper.marks,
    },
  }
}

function readSource(v: unknown): SourceRef {
  if (!isRecord(v)) throw new SchemaError('source must be an object')
  if (v.kind === 'sample') return { kind: 'sample', id: 'harbour' }
  if (v.kind === 'image' && typeof v.blobId === 'string' && v.blobId.length < 100) {
    const w = num(v.width, 'source.width', { min: 1, max: 100_000 })
    const h = num(v.height, 'source.height', { min: 1, max: 100_000 })
    const type = typeof v.type === 'string' && /^image\/(jpeg|png|webp)$/.test(v.type) ? v.type : 'image/png'
    return { kind: 'image', blobId: v.blobId, name: sanitizeName(v.name), width: w, height: h, type }
  }
  throw new SchemaError('source.kind must be sample or image')
}

export function parseDocument(raw: unknown): EditionDocument {
  if (!isRecord(raw)) throw new SchemaError('document must be an object')
  if (raw.version !== SCHEMA_VERSION) {
    throw new SchemaError(typeof raw.version === 'number' && raw.version > SCHEMA_VERSION
      ? `saved by a newer Edition (v${raw.version})` : `unknown document version ${String(raw.version)}`)
  }
  return {
    version: SCHEMA_VERSION,
    id: typeof raw.id === 'string' && raw.id.length < 100 ? raw.id : newId(),
    name: sanitizeName(raw.name),
    source: readSource(raw.source),
    settings: readSettings(raw.settings),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
}
