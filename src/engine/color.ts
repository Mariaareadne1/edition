/**
 * Colour conversions used by the separation and compositing model.
 *
 * Inputs are treated as sRGB (what canvas getImageData returns in the default
 * 'srgb' colour space — browsers convert tagged images to sRGB on decode, so
 * wide-gamut sources are clipped; this is a documented limitation, not ICC).
 */

export type RGB = [number, number, number]

/** sRGB-encoded 0–1 → linear-light 0–1 */
export function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** linear-light 0–1 → sRGB-encoded 0–1 */
export function toSrgb(c: number): number {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/** 256-entry lookup: 8-bit sRGB → linear. */
export const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256)
  for (let i = 0; i < 256; i++) t[i] = toLinear(i / 255)
  return t
})()

/** 4096-entry lookup: linear (quantised) → 8-bit sRGB. */
const LINEAR_STEPS = 4095
export const LINEAR_TO_SRGB8 = (() => {
  const t = new Uint8ClampedArray(LINEAR_STEPS + 1)
  for (let i = 0; i <= LINEAR_STEPS; i++) t[i] = Math.round(toSrgb(i / LINEAR_STEPS) * 255)
  return t
})()

export function linearToSrgb8(c: number): number {
  return LINEAR_TO_SRGB8[Math.round((c <= 0 ? 0 : c >= 1 ? 1 : c) * LINEAR_STEPS)]!
}

const HEX = /^#([0-9a-f]{6})$/i

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value)
}

/** "#rrggbb" → sRGB-encoded 0–1 triple. */
export function hexToRgb(hex: string): RGB {
  const m = HEX.exec(hex)
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`)
  const n = parseInt(m[1]!, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export function hexToLinear(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex)
  return [toLinear(r), toLinear(g), toLinear(b)]
}

export function rgbToHex([r, g, b]: RGB): string {
  const h = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Linear sRGB → OKLab (Björn Ottosson, 2020). */
export function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** Unit hue direction (a, b) of a colour in OKLab; [0, 0] for neutrals. */
export function hueDirection(hex: string): [number, number] {
  const [r, g, b] = hexToLinear(hex)
  const [, a, bb] = linearToOklab(r, g, b)
  const len = Math.hypot(a, bb)
  return len < 1e-4 ? [0, 0] : [a / len, bb / len]
}
