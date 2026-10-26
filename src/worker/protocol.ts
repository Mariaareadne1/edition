import type { RenderMode } from '../engine/render'
import type { PrintSettings } from '../engine/types'

/** Pixels the workers analyse: either the procedural sample or decoded image data. */
export type SourcePayload =
  | { kind: 'sample'; width: number; height: number }
  | { kind: 'pixels'; width: number; height: number; rgba: Uint8ClampedArray }

export type ToWorker =
  | { type: 'paint'; id: number; width: number; height: number }
  | { type: 'source'; sourceId: number; source: SourcePayload }
  | {
      type: 'render'; id: number; sourceId: number; settings: PrintSettings; mode: RenderMode; longEdge: number; rowStart: number; rowEnd: number
      /** optional column window: the rows are rendered in full, then cropped before transfer (loupe) */
      colStart?: number; colEnd?: number
    }
  | { type: 'export'; id: number; sourceId: number; settings: PrintSettings; longEdge: number; outputs: ExportOutput[] }

export type ExportOutput = 'print' | 'film1' | 'film2'

export type FromWorker =
  | { type: 'painted'; id: number; rgba: Uint8ClampedArray }
  | { type: 'rows'; id: number; rowStart: number; rowEnd: number; width: number; height: number; pixels: Uint8ClampedArray; ms: number; colStart?: number; colEnd?: number }
  | { type: 'progress'; id: number; done: number; total: number; stage: string }
  | { type: 'exported'; id: number; files: Array<{ output: ExportOutput; blob: Blob; width: number; height: number }> }
  | { type: 'error'; id: number; message: string }
