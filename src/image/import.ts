/**
 * Local image import. Nothing leaves the browser: files are validated by size,
 * declared type and magic bytes, decoded by the browser, and downscaled to the
 * analysis resolution. The original bytes are kept (IndexedDB) for reloads.
 */

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AcceptedType = (typeof ACCEPTED_TYPES)[number]

export const MAX_FILE_BYTES = 60 * 1024 * 1024
export const MAX_PIXELS = 100_000_000
/** Long edge of the pixels the separation analyses (preview and export share it). */
export const ANALYSIS_LONG_EDGE = 1800

export class ImportError extends Error {}

/** Identify JPEG / PNG / WebP from the first bytes; null if none match. */
export function sniffType(head: Uint8Array): AcceptedType | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png'
  const ascii = (a: number, b: number) => String.fromCharCode(...head.slice(a, b))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

export function analysisSize(width: number, height: number, longEdge = ANALYSIS_LONG_EDGE) {
  const s = Math.min(1, longEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) }
}

export interface DecodedImage {
  type: AcceptedType
  /** original dimensions */
  width: number
  height: number
  /** analysis-resolution pixels */
  pixels: { width: number; height: number; rgba: Uint8ClampedArray }
}

async function naturalSize(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return { width: img.naturalWidth, height: img.naturalHeight }
  } catch {
    throw new ImportError('The file could not be decoded as an image.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (blob.size === 0) throw new ImportError('The file is empty.')
  if (blob.size > MAX_FILE_BYTES) throw new ImportError(`The file is ${(blob.size / 1e6).toFixed(0)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
  const type = sniffType(new Uint8Array(await blob.slice(0, 16).arrayBuffer()))
  if (!type) throw new ImportError('Only JPEG, PNG and WebP images are supported.')

  const { width, height } = await naturalSize(blob)
  if (!width || !height) throw new ImportError('The image has no dimensions.')
  if (width * height > MAX_PIXELS) throw new ImportError(`The image is ${((width * height) / 1e6).toFixed(0)} megapixels; the limit is ${MAX_PIXELS / 1e6}.`)

  const target = analysisSize(width, height)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high', imageOrientation: 'from-image' })
  } catch {
    throw new ImportError('The browser could not decode this image.')
  }
  try {
    const canvas = new OffscreenCanvas(target.width, target.height)
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' })
    if (!ctx) throw new ImportError('Canvas is unavailable in this browser.')
    ctx.drawImage(bitmap, 0, 0)
    const rgba = ctx.getImageData(0, 0, target.width, target.height, { colorSpace: 'srgb' }).data
    return { type, width, height, pixels: { ...target, rgba } }
  } finally {
    bitmap.close()
  }
}
