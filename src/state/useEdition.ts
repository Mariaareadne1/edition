import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { commit, createHistory, preview, push, redo, reset, undo, type History } from './history'
import { createDocument, newId, parseDocument, readSettings, SchemaError, type EditionDocument } from './document'
import type { PrintSettings } from '../engine/types'
import { decodeImage, ImportError, analysisSize } from '../image/import'
import { SAMPLE_ASPECT } from '../engine/sample'
import { storage } from '../storage/db'
import type { SourcePayload } from '../worker/protocol'

type Action =
  | { type: 'preview'; settings: PrintSettings }
  | { type: 'push'; settings: PrintSettings }
  | { type: 'rename'; name: string }
  | { type: 'commit' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'load'; doc: EditionDocument }

const same = (a: EditionDocument, b: EditionDocument) => a.name === b.name && JSON.stringify(a.settings) === JSON.stringify(b.settings)
const touch = (d: EditionDocument, patch: Partial<EditionDocument>): EditionDocument => ({ ...d, ...patch, updatedAt: Date.now() })

function reducer(h: History<EditionDocument>, a: Action): History<EditionDocument> {
  switch (a.type) {
    case 'preview':
      return preview(h, touch(h.present, { settings: a.settings }))
    case 'push': {
      const next = touch(h.present, { settings: a.settings })
      return same(next, h.present) ? commit(h, same) : push(commit(h, same), next)
    }
    case 'rename':
      return a.name === h.present.name ? h : push(commit(h, same), touch(h.present, { name: a.name }))
    case 'commit':
      return commit(h, same)
    case 'undo':
      return undo(h)
    case 'redo':
      return redo(h)
    case 'load':
      return reset(a.doc)
  }
}

export const SAMPLE_SIZE = analysisSize(1440, 1440 / SAMPLE_ASPECT)

export type SourceState =
  | { status: 'loading'; message: string }
  | { status: 'ready'; payload: SourcePayload; blob: Blob | null; label: string }
  | { status: 'error'; message: string }

export type SaveState = { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'error'; message: string } | { kind: 'idle' }

const samplePayload = (): SourcePayload => ({ kind: 'sample', ...SAMPLE_SIZE })

export function useEdition() {
  const [history, dispatch] = useReducer(reducer, undefined, () => createHistory(createDocument()))
  const doc = history.present
  const [source, setSource] = useState<SourceState>({ status: 'loading', message: 'Opening your last print…' })
  const [notice, setNotice] = useState<string | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [booted, setBooted] = useState(false)
  const loadedDoc = useRef<EditionDocument | null>(null)

  // ── boot: restore the last document and its image ──────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let restored: EditionDocument | null = null
      try {
        const raw = await storage.getDoc()
        if (raw !== undefined) restored = parseDocument(raw)
      } catch (err) {
        setNotice(err instanceof SchemaError ? `Your saved print couldn’t be read (${err.message}); starting from the sample.` : 'Browser storage is unavailable; work will not be saved.')
      }
      if (cancelled) return
      if (restored?.source.kind === 'image') {
        try {
          const blob = await storage.getBlob(restored.source.blobId)
          if (!blob) throw new ImportError('The saved image is missing from this browser’s storage.')
          const decoded = await decodeImage(blob)
          if (cancelled) return
          setSource({ status: 'ready', payload: { kind: 'pixels', ...decoded.pixels }, blob, label: restored.source.name })
        } catch (err) {
          setNotice(`${err instanceof Error ? err.message : 'The saved image could not be opened'} Your print settings are kept, on the sample.`)
          restored = { ...restored, source: { kind: 'sample', id: 'harbour' } }
          setSource({ status: 'ready', payload: samplePayload(), blob: null, label: 'Harbour, dusk (sample)' })
        }
      } else {
        setSource({ status: 'ready', payload: samplePayload(), blob: null, label: 'Harbour, dusk (sample)' })
      }
      if (restored) dispatch({ type: 'load', doc: restored })
      loadedDoc.current = restored
      setBooted(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ── autosave (after boot, not during gestures, not before a change) ────
  const gestureOpen = history.gestureStart !== null
  useEffect(() => {
    if (!booted || gestureOpen || doc === loadedDoc.current) return
    setSave({ kind: 'saving' })
    const t = window.setTimeout(async () => {
      try {
        await storage.putDoc(doc)
        await storage.pruneBlobs(doc.source.kind === 'image' ? doc.source.blobId : null)
        setSave({ kind: 'saved', at: Date.now() })
      } catch (err) {
        setSave({ kind: 'error', message: err instanceof Error ? err.message : 'Could not save.' })
      }
    }, 400)
    return () => window.clearTimeout(t)
  }, [doc, booted, gestureOpen])

  // ── actions ─────────────────────────────────────────────────────────────
  const previewSettings = useCallback((settings: PrintSettings) => dispatch({ type: 'preview', settings }), [])
  const pushSettings = useCallback((settings: PrintSettings) => dispatch({ type: 'push', settings }), [])
  const commitGesture = useCallback(() => dispatch({ type: 'commit' }), [])

  const importImage = useCallback(async (file: Blob, name: string) => {
    setSource((s) => (s.status === 'ready' ? s : { status: 'loading', message: 'Decoding…' }))
    const decoded = await decodeImage(file) // throws ImportError with a readable message
    const blobId = newId()
    try {
      await storage.putBlob(blobId, file)
    } catch {
      setNotice('The image is open but could not be saved in this browser; it won’t survive a reload.')
    }
    const docName = name.replace(/\.[a-z0-9]+$/i, '') || 'Untitled print'
    setSource({ status: 'ready', payload: { kind: 'pixels', ...decoded.pixels }, blob: file, label: name })
    dispatch({
      type: 'load',
      doc: { ...createDocument({ kind: 'image', blobId, name, width: decoded.width, height: decoded.height, type: decoded.type }, docName), settings: history.present.settings },
    })
  }, [history.present.settings])

  const useSample = useCallback(() => {
    setSource({ status: 'ready', payload: samplePayload(), blob: null, label: 'Harbour, dusk (sample)' })
    dispatch({ type: 'load', doc: { ...createDocument(), settings: history.present.settings } })
  }, [history.present.settings])

  /** Settings only, as readable JSON — never claims to contain the image. */
  const exportSettings = useCallback((): { name: string; data: Uint8Array } => {
    const payload = { kind: 'edition-settings', version: doc.version, name: doc.name, settings: doc.settings }
    return { name: `${slug(doc.name)}.settings.json`, data: strToU8(JSON.stringify(payload, null, 2)) }
  }, [doc])

  /** `.edition` = zip of document.json plus the original image bytes when there is one. */
  const exportPackageWithImage = useCallback(async (): Promise<{ name: string; data: Uint8Array }> => {
    const files: Record<string, Uint8Array> = { 'document.json': strToU8(JSON.stringify(doc, null, 2)) }
    if (source.status === 'ready' && source.blob && doc.source.kind === 'image') {
      files[`source.${doc.source.type.split('/')[1]}`] = new Uint8Array(await source.blob.arrayBuffer())
    }
    return { name: `${slug(doc.name)}.edition`, data: zipSync(files, { level: 0 }) }
  }, [doc, source])

  const importPackage = useCallback(async (file: File): Promise<string> => {
    if (file.size > 80 * 1024 * 1024) throw new ImportError('That file is too large to be an Edition package.')
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes[0] === 0x7b /* { */) {
      const parsed: unknown = JSON.parse(strFromU8(bytes))
      const raw = (parsed as { settings?: unknown }).settings ?? parsed
      dispatch({ type: 'push', settings: readSettings(raw) })
      return 'Settings applied to the current image. (A .json file holds settings only — no image.)'
    }
    let entries: Record<string, Uint8Array>
    try {
      entries = unzipSync(bytes)
    } catch {
      throw new ImportError('That file is not an Edition package or settings file.')
    }
    const docEntry = entries['document.json']
    if (!docEntry) throw new ImportError('The package has no document.json.')
    const parsed = parseDocument(JSON.parse(strFromU8(docEntry)))
    const imageName = Object.keys(entries).find((k) => k.startsWith('source.'))
    if (parsed.source.kind === 'image' && imageName) {
      const blob = new Blob([entries[imageName]! as BlobPart], { type: parsed.source.type })
      await importImage(blob, parsed.source.name)
      dispatch({ type: 'push', settings: parsed.settings })
      dispatch({ type: 'rename', name: parsed.name })
      return `Opened “${parsed.name}” with its image.`
    }
    setSource({ status: 'ready', payload: samplePayload(), blob: null, label: 'Harbour, dusk (sample)' })
    dispatch({ type: 'load', doc: { ...parsed, id: newId(), source: { kind: 'sample', id: 'harbour' } } })
    return parsed.source.kind === 'image'
      ? `Opened “${parsed.name}”. The package had no image, so it is shown on the sample.`
      : `Opened “${parsed.name}”.`
  }, [importImage])

  const actions = useMemo(
    () => ({
      preview: previewSettings,
      push: pushSettings,
      commit: commitGesture,
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      rename: (name: string) => dispatch({ type: 'rename', name }),
      importImage,
      useSample,
      exportSettings,
      exportPackageWithImage,
      importPackage,
      dismissNotice: () => setNotice(null),
      setNotice,
    }),
    [previewSettings, pushSettings, commitGesture, importImage, useSample, exportSettings, exportPackageWithImage, importPackage],
  )

  return {
    doc,
    settings: doc.settings,
    source,
    notice,
    save,
    canUndo: history.past.length > 0 || gestureOpen,
    canRedo: history.future.length > 0,
    actions,
  }
}

export type Edition = ReturnType<typeof useEdition>

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'edition'
}
