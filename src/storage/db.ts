/**
 * IndexedDB persistence: the current document and the original bytes of any
 * imported image. Everything stays on this device.
 */
const DB_NAME = 'edition'
const DB_VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs')
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is unavailable'))
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })
}

let dbPromise: Promise<IDBDatabase> | null = null
const db = () => (dbPromise ??= open())

function run<T>(store: 'docs' | 'blobs', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      }),
  )
}

export const CURRENT_KEY = 'current'

export const storage = {
  getDoc: () => run<unknown>('docs', 'readonly', (s) => s.get(CURRENT_KEY)),
  putDoc: (doc: unknown) => run('docs', 'readwrite', (s) => s.put(doc, CURRENT_KEY)),
  // Stored as ArrayBuffer + type: WebKit cannot store Blobs in IndexedDB in
  // private/ephemeral sessions, but ArrayBuffers work everywhere.
  getBlob: async (id: string): Promise<Blob | undefined> => {
    const rec = await run<{ type: string; bytes: ArrayBuffer } | undefined>('blobs', 'readonly', (s) => s.get(id))
    return rec ? new Blob([rec.bytes], { type: rec.type }) : undefined
  },
  putBlob: async (id: string, blob: Blob) => {
    const bytes = await blob.arrayBuffer()
    await run('blobs', 'readwrite', (s) => s.put({ type: blob.type, bytes }, id))
  },
  /** Remove every stored blob except `keep` (images that are no longer referenced). */
  pruneBlobs: async (keep: string | null) => {
    const keys = await run<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys())
    await Promise.all(keys.filter((k) => k !== keep).map((k) => run('blobs', 'readwrite', (s) => s.delete(k))))
  },
}
