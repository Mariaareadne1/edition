import { sheetLayout, type RenderMode } from '../engine/render'
import type { PrintSettings } from '../engine/types'
import type { ExportOutput, FromWorker, SourcePayload, ToWorker } from './protocol'

/** A window of the sheet in output pixels at the requested long edge. */
export interface Region {
  rowStart: number
  rowEnd: number
  colStart: number
  colEnd: number
}

export interface RenderedImage {
  image: ImageData
  ms: number
  mode: RenderMode
  settings: PrintSettings
  /** set when only a window of the sheet was rendered (the loupe) */
  region?: Region
}

/**
 * Independent latest-wins queues: the proof, the split view's source, the
 * loupe's full-resolution window, and the two separated plates shown while
 * the plates are lifted apart. Earlier lanes in PRIORITY run first.
 */
export type Lane = 'proof' | 'source' | 'loupe' | 'plate1' | 'plate2'
const PRIORITY: Lane[] = ['proof', 'loupe', 'source', 'plate1', 'plate2']

export interface RenderOptions {
  lane?: Lane
  region?: Region
}

interface Job {
  source: SourcePayload
  settings: PrintSettings
  mode: RenderMode
  longEdge: number
  region?: Region
  resolve: (r: RenderedImage | null) => void
  reject: (e: Error) => void
}

const laneOf = (mode: RenderMode): Lane => (mode === 'source' ? 'source' : 'proof')

const spawn = () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })

class WorkerCrashed extends Error {}

/**
 * A preview band normally answers in well under a second. A worker silent for
 * this long is treated as crashed (replaced, render retried once) so the proof
 * can never wait forever — e.g. when the OS starves or wedges a worker.
 */
const STALL_MS = 30_000

/**
 * Preview renderer: a few workers each render a band of rows. Within a lane
 * requests are latest-wins — while a render is in flight, newer requests
 * replace each other and only the newest runs next, so dragging a slider never
 * queues stale work. A worker that crashes is replaced and the source re-sent.
 */
export class RenderPool {
  private workers: Worker[]
  private sourceId = 0
  private nextId = 1
  private dims = { width: 1, height: 1 }
  private current: SourcePayload | null = null
  /** resolves when every worker has been sent the current source */
  private ready: Promise<void> = Promise.resolve()
  private pending = new Map<Lane, Job>()
  private busy = false
  private disposed = false

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))) {
    this.workers = Array.from({ length: size }, () => this.create())
  }

  get size() {
    return this.workers.length
  }

  private create(): Worker {
    const w = spawn()
    w.addEventListener('error', () => this.replace(w))
    return w
  }

  /** Swap a crashed worker for a fresh one; the next render re-sends the source. */
  private replace(dead: Worker) {
    const i = this.workers.indexOf(dead)
    if (i < 0 || this.disposed) return
    dead.terminate()
    this.workers[i] = this.create()
    this.current = null
  }

  /**
   * Load a source into every worker; repeated calls with the same payload are
   * free. The procedural sample is painted once (by the first worker) and the
   * pixels shared, rather than painted by every worker.
   */
  setSource(source: SourcePayload): void {
    if (source === this.current) return
    this.current = source
    const id = ++this.sourceId
    this.dims = { width: source.width, height: source.height }
    this.ready = (source.kind === 'sample' ? this.paint(source.width, source.height) : Promise.resolve(source)).then((pixels) => {
      if (id === this.sourceId) this.broadcast(pixels)
    })
  }

  private paint(width: number, height: number): Promise<SourcePayload> {
    const w = this.workers[0]!
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const watchdog = window.setTimeout(() => {
        done()
        this.replace(w)
        reject(new WorkerCrashed('The render worker stopped responding while painting the sample.'))
      }, STALL_MS)
      const done = () => {
        window.clearTimeout(watchdog)
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onError)
      }
      const onMessage = (e: MessageEvent<FromWorker>) => {
        if (e.data.id !== id) return
        done()
        if (e.data.type === 'painted') resolve({ kind: 'pixels', width, height, rgba: e.data.rgba })
        else if (e.data.type === 'error') reject(new Error(e.data.message))
      }
      const onError = () => {
        done()
        reject(new WorkerCrashed('The render worker stopped while painting the sample.'))
      }
      w.addEventListener('message', onMessage)
      w.addEventListener('error', onError)
      w.postMessage({ type: 'paint', id, width, height } satisfies ToWorker)
    })
  }

  private broadcast(source: SourcePayload): void {
    for (const w of this.workers) {
      // Each worker gets its own copy of the pixels.
      const copy: SourcePayload = source.kind === 'pixels' ? { ...source, rgba: source.rgba.slice() } : source
      const msg: ToWorker = { type: 'source', sourceId: this.sourceId, source: copy }
      w.postMessage(msg, copy.kind === 'pixels' ? [copy.rgba.buffer] : [])
    }
  }

  /**
   * Resolves with the image, or null if a newer request in the same lane
   * superseded it (or the pool was disposed); rejects if rendering failed.
   */
  render(source: SourcePayload, settings: PrintSettings, mode: RenderMode, longEdge: number, opts: RenderOptions = {}): Promise<RenderedImage | null> {
    if (this.disposed) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
      const lane = opts.lane ?? laneOf(mode)
      this.pending.get(lane)?.resolve(null)
      this.pending.set(lane, { source, settings, mode, longEdge, region: opts.region, resolve, reject })
      if (!this.busy) void this.drain()
    })
  }

  private next(): Job | null {
    for (const lane of PRIORITY) {
      const job = this.pending.get(lane)
      if (job) {
        this.pending.delete(lane)
        return job
      }
    }
    return null
  }

  private async drain(): Promise<void> {
    this.busy = true
    let job: Job | null
    while (!this.disposed && (job = this.next())) {
      try {
        let result: RenderedImage | null = null
        for (let attempt = 0; attempt < 2 && result === null; attempt++) {
          try {
            // (Re)load the source inside the attempt so a replaced worker receives it.
            this.setSource(job.source)
            await this.ready
            result = job.region
              ? await this.renderRegionNow(job.settings, job.mode, job.longEdge, job.region)
              : await this.renderNow(job.settings, job.mode, job.longEdge)
          } catch (err) {
            if (!(err instanceof WorkerCrashed) || attempt === 1) throw err
          }
        }
        job.resolve(result)
      } catch (err) {
        job.reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    this.busy = false
  }

  private renderNow(settings: PrintSettings, mode: RenderMode, longEdge: number): Promise<RenderedImage> {
    const id = this.nextId++
    const sourceId = this.sourceId
    const t0 = performance.now()
    return new Promise((resolve, reject) => {
      // The layout is pure, so the main thread can split the sheet evenly.
      const maxHeight = sheetLayout(this.dims.width, this.dims.height, longEdge, settings.paper.margin).height
      const band = Math.ceil(maxHeight / this.workers.length)
      let width = 0
      let image: ImageData | null = null
      let remaining = this.workers.length
      const cleanups: Array<() => void> = []
      const silent = new Set(this.workers)
      let settled = false
      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        window.clearTimeout(watchdog)
        for (const c of cleanups) c()
        if (err) reject(err)
        else resolve({ image: image!, ms: performance.now() - t0, mode, settings })
      }
      const watchdog = window.setTimeout(() => {
        for (const w of [...silent]) this.replace(w)
        finish(new WorkerCrashed('A render worker stopped responding.'))
      }, STALL_MS)
      this.workers.forEach((w, i) => {
        const onMessage = (e: MessageEvent<FromWorker>) => {
          const msg = e.data
          if (msg.id !== id) return
          silent.delete(w)
          if (msg.type === 'error') return finish(new Error(msg.message))
          if (msg.type !== 'rows') return
          if (!image) {
            width = msg.width
            image = new ImageData(width, msg.height)
          }
          if (msg.rowEnd > msg.rowStart) image.data.set(msg.pixels, msg.rowStart * width * 4)
          if (--remaining === 0) finish()
        }
        const onError = () => finish(new WorkerCrashed('A render worker stopped (possibly out of memory).'))
        w.addEventListener('message', onMessage)
        w.addEventListener('error', onError)
        cleanups.push(() => {
          w.removeEventListener('message', onMessage)
          w.removeEventListener('error', onError)
        })
        const msg: ToWorker = { type: 'render', id, sourceId, settings, mode, longEdge, rowStart: Math.min(maxHeight, i * band), rowEnd: Math.min(maxHeight, (i + 1) * band) }
        w.postMessage(msg)
      })
    })
  }

  /** One worker renders the rows of a window and crops it to its columns. */
  private renderRegionNow(settings: PrintSettings, mode: RenderMode, longEdge: number, region: Region): Promise<RenderedImage> {
    const id = this.nextId++
    const w = this.workers[0]!
    const t0 = performance.now()
    return new Promise((resolve, reject) => {
      const watchdog = window.setTimeout(() => {
        cleanup()
        this.replace(w)
        reject(new WorkerCrashed('A render worker stopped responding.'))
      }, STALL_MS)
      const cleanup = () => {
        window.clearTimeout(watchdog)
        w.removeEventListener('message', onMessage)
        w.removeEventListener('error', onError)
      }
      const onMessage = (e: MessageEvent<FromWorker>) => {
        const msg = e.data
        if (msg.id !== id) return
        cleanup()
        if (msg.type === 'error') return reject(new Error(msg.message))
        if (msg.type !== 'rows') return
        const cols = (msg.colEnd ?? msg.width) - (msg.colStart ?? 0)
        const rows = msg.rowEnd - msg.rowStart
        if (cols <= 0 || rows <= 0) return reject(new Error('The loupe window is outside the sheet.'))
        const image = new ImageData(new Uint8ClampedArray(msg.pixels), cols, rows)
        resolve({ image, ms: performance.now() - t0, mode, settings, region: { rowStart: msg.rowStart, rowEnd: msg.rowEnd, colStart: msg.colStart ?? 0, colEnd: msg.colEnd ?? msg.width } })
      }
      const onError = () => {
        cleanup()
        reject(new WorkerCrashed('A render worker stopped (possibly out of memory).'))
      }
      w.addEventListener('message', onMessage)
      w.addEventListener('error', onError)
      const msg: ToWorker = { type: 'render', id, sourceId: this.sourceId, settings, mode, longEdge, rowStart: Math.max(0, region.rowStart), rowEnd: region.rowEnd, colStart: region.colStart, colEnd: region.colEnd }
      w.postMessage(msg)
    })
  }

  dispose(): void {
    this.disposed = true
    for (const job of this.pending.values()) job.resolve(null)
    this.pending.clear()
    for (const w of this.workers) w.terminate()
  }
}

export interface ExportJob {
  promise: Promise<Array<{ output: ExportOutput; blob: Blob; width: number; height: number }>>
  cancel: () => void
}

export class ExportCancelled extends Error {}

/** Full-resolution export in its own worker, with progress; cancel terminates it. */
export function runExport(
  source: SourcePayload,
  settings: PrintSettings,
  longEdge: number,
  outputs: ExportOutput[],
  onProgress: (done: number, total: number, stage: string) => void,
): ExportJob {
  const worker = spawn()
  let settle: (err?: Error) => void = () => {}
  const promise = new Promise<Array<{ output: ExportOutput; blob: Blob; width: number; height: number }>>((resolve, reject) => {
    settle = (err) => {
      worker.terminate()
      if (err) reject(err)
    }
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data
      if (msg.type === 'progress') onProgress(msg.done, msg.total, msg.stage)
      else if (msg.type === 'error') settle(new Error(msg.message))
      else if (msg.type === 'exported') {
        worker.terminate()
        resolve(msg.files)
      }
    }
    worker.onerror = (e) => settle(new Error(e.message || 'Export worker crashed (possibly out of memory).'))
  })
  const copy: SourcePayload = source.kind === 'pixels' ? { ...source, rgba: source.rgba.slice() } : source
  worker.postMessage({ type: 'source', sourceId: 1, source: copy } satisfies ToWorker, copy.kind === 'pixels' ? [copy.rgba.buffer] : [])
  worker.postMessage({ type: 'export', id: 1, sourceId: 1, settings, longEdge, outputs } satisfies ToWorker)
  return { promise, cancel: () => settle(new ExportCancelled('Export cancelled.')) }
}
