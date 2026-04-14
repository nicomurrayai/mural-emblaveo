import { brighten, lumaFromRgb, mixColors } from './color'
import type { MosaicAsset, RGB } from '../types/mosaic'

const DEMO_PALETTE: RGB[] = [
  { r: 28, g: 173, b: 112 },
  { r: 47, g: 129, b: 104 },
  { r: 29, g: 29, b: 70 },
  { r: 47, g: 62, b: 129 },
  { r: 211, g: 140, b: 106 },
  { r: 136, g: 94, b: 65 },
  { r: 181, g: 199, b: 236 },
  { r: 98, g: 111, b: 182 },
]

function tileSvg(color: RGB, index: number) {
  const accent = brighten(color, 0.22)
  const shadow = mixColors(color, { r: 9, g: 10, b: 24 }, 0.64)
  const label = `E${String(index + 1).padStart(3, '0')}`

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="rgb(${accent.r},${accent.g},${accent.b})" />
          <stop offset="100%" stop-color="rgb(${shadow.r},${shadow.g},${shadow.b})" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="34" fill="url(#g)" />
      <rect x="24" y="24" width="208" height="208" rx="24" fill="none" stroke="rgba(255,255,255,0.18)" />
      <circle cx="68" cy="70" r="24" fill="rgba(255,255,255,0.18)" />
      <path d="M38 184c34-54 60-81 86-81 22 0 44 18 72 54l22 27H38Z" fill="rgba(9,10,24,0.32)" />
      <text x="30" y="224" font-size="22" font-family="Azeret Mono, monospace" fill="rgba(255,255,255,0.76)">${label}</text>
    </svg>
  `)}`
}

export function createDemoAssets(total = 1000): MosaicAsset[] {
  const baseDate = Date.parse('2026-04-13T18:00:00.000Z')

  return Array.from({ length: total }, (_, index) => {
    const color = DEMO_PALETTE[index % DEMO_PALETTE.length]
    const createdAt = new Date(baseDate + index * 18000).toISOString()

    return {
      photoId: `demo-${index + 1}`,
      thumbUrl: tileSvg(color, index),
      avgRgb: color,
      luma: lumaFromRgb(color),
      aspectRatio: 1,
      processedAt: createdAt,
      createdAt,
      status: 'ready',
      sourceImageUrl: null,
    }
  })
}
