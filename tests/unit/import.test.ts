import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { checkPixels, headerSize, ImportError, sniffType, MAX_PIXELS } from '../../src/image/import'

const pngBytes = (w: number, h: number) => new Uint8Array(PNG.sync.write(Object.assign(new PNG({ width: w, height: h }), {})))

describe('import validation', () => {
  it('sniffs real types and rejects text', () => {
    expect(sniffType(pngBytes(3, 2))).toBe('image/png')
    expect(sniffType(new TextEncoder().encode('hello there, not an image'))).toBeNull()
  })

  it('reads PNG dimensions from the header', () => {
    expect(headerSize(pngBytes(37, 21), 'image/png')).toEqual({ width: 37, height: 21 })
  })

  it('reads JPEG dimensions from the SOF marker, skipping APP segments', () => {
    // SOI, APP0 (16 bytes), SOF0 with height 300, width 500
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xf4, 0x03])
    expect(headerSize(bytes, 'image/jpeg')).toEqual({ width: 500, height: 300 })
  })

  it('reads WebP VP8X dimensions', () => {
    const b = new Uint8Array(30)
    b.set(new TextEncoder().encode('RIFF'), 0)
    b.set(new TextEncoder().encode('WEBPVP8X'), 8)
    b.set([0x1f, 0x4e, 0x00], 24) // width - 1 = 19999
    b.set([0x0f, 0x27, 0x00], 27) // height - 1 = 9999
    expect(headerSize(b, 'image/webp')).toEqual({ width: 20000, height: 10000 })
  })

  it('refuses images over the pixel limit before decoding', () => {
    expect(() => checkPixels(20000, 20000)).toThrow(ImportError)
    expect(() => checkPixels(20000, 20000)).toThrow(/400 megapixels/)
    expect(() => checkPixels(1000, MAX_PIXELS / 1000)).not.toThrow()
  })
})
