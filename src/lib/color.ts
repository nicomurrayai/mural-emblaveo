import type { RGB } from '../types/mosaic'

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function lumaFromRgb(color: RGB) {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
}

export function colorDistance(left: RGB, right: RGB) {
  const dr = left.r - right.r
  const dg = left.g - right.g
  const db = left.b - right.b

  return Math.sqrt(dr * dr + dg * dg + db * db)
}

export function mixColors(left: RGB, right: RGB, ratio: number): RGB {
  const mix = clamp(ratio, 0, 1)

  return {
    r: Math.round(left.r + (right.r - left.r) * mix),
    g: Math.round(left.g + (right.g - left.g) * mix),
    b: Math.round(left.b + (right.b - left.b) * mix),
  }
}

export function darken(color: RGB, ratio: number): RGB {
  return mixColors(color, { r: 0, g: 0, b: 0 }, ratio)
}

export function brighten(color: RGB, ratio: number): RGB {
  return mixColors(color, { r: 255, g: 255, b: 255 }, ratio)
}

export function rgbToCss(color: RGB, alpha = 1) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`
}
