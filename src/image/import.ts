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

/**
 * Image dimensions from the file header, without decoding pixels, so the pixel
 * limit is enforced before the browser allocates a full-size bitmap.
 * Returns null if the header can't be read.
 */
export function headerSize(bytes: Uint8Array, type: AcceptedType): { width: number; height: number } | null {
  const u16be = (i: number) => (bytes[i]! << 8) | bytes[i + 1]!
  const u32be = (i: number) => ((bytes[i]! << 24) >>> 0) + (bytes[i + 1]! << 16) + (bytes[i + 2]! << 8) + bytes[i + 3]!
  const u24le = (i: number) => bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16)
  if (type === 'image/png') {
    if (bytes.length < 24) return null
    return { width: u32be(16), height: u32be(20) }
  }
  if (type === 'image/jpeg') {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null
      const marker = bytes[i + 1]!
      if (marker === 0xff) { i++; continue }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { height: u16be(i + 5), width: u16be(i + 7) }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      i += 2 + u16be(i + 2)
    }
    return null
  }
  // WebP: RIFF....WEBP then a VP8 / VP8L / VP8X chunk.
  const chunk = String.fromCharCode(...bytes.slice(12, 16))
  if (chunk === 'VP8 ' && bytes.length >= 30) return { width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff, height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const [b0, b1, b2, b3] = [bytes[21]!, bytes[22]!, bytes[23]!, bytes[24]!]
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
  }
  if (chunk === 'VP8X' && bytes.length >= 30) return { width: 1 + u24le(24), height: 1 + u24le(27) }
  return null
}

export function checkPixels(width: number, height: number): void {
  if (!width || !height) throw new ImportError('The image has no dimensions.')
  if (width * height > MAX_PIXELS) throw new ImportError(`The image is ${((width * height) / 1e6).toFixed(0)} megapixels; the limit is ${MAX_PIXELS / 1e6}.`)
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
  const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer())
  const type = sniffType(head)
  if (!type) throw new ImportError('Only JPEG, PNG and WebP images are supported.')

  // Refuse oversized images from the header, before any decode.
  const declared = headerSize(head, type)
  if (declared) checkPixels(declared.width, declared.height)
  const { width, height } = await naturalSize(blob)
  checkPixels(width, height)

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
