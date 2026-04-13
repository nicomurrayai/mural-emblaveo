import { describe, expect, it } from 'vitest'
import { buildMosaicPlacements, mergeMosaicAssets } from './mosaic'
import type { MosaicAsset, MosaicCell } from '../types/mosaic'

function makeCell(
  id: string,
  red: number,
  green: number,
  blue: number,
): MosaicCell {
  return {
    id,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    targetRgb: { r: red, g: green, b: blue },
    targetLuma: red * 0.2126 + green * 0.7152 + blue * 0.0722,
    alphaCoverage: 1,
    occupiedByPhotoId: null,
  }
}

function makeAsset(
  photoId: string,
  red: number,
  green: number,
  blue: number,
  createdAt = '2026-04-13T18:00:00.000Z',
): MosaicAsset {
  return {
    photoId,
    thumbUrl: `https://example.com/${photoId}.jpg`,
    avgRgb: { r: red, g: green, b: blue },
    luma: red * 0.2126 + green * 0.7152 + blue * 0.0722,
    aspectRatio: 1,
    processedAt: createdAt,
    createdAt,
    status: 'ready',
  }
}

describe('buildMosaicPlacements', () => {
  it('never assigns two assets to the same cell', () => {
    const cells = [
      makeCell('green-zone', 30, 160, 90),
      makeCell('blue-zone', 20, 30, 90),
    ]
    const assets = [
      makeAsset('a', 25, 150, 88),
      makeAsset('b', 26, 36, 95, '2026-04-13T18:05:00.000Z'),
    ]

    const result = buildMosaicPlacements(cells, assets)
    const occupiedCellIds = result.placements.map((placement) => placement.cell.id)

    expect(new Set(occupiedCellIds).size).toBe(occupiedCellIds.length)
  })

  it('matches an asset to the closest target color', () => {
    const cells = [
      makeCell('green-zone', 30, 160, 90),
      makeCell('blue-zone', 20, 30, 90),
    ]
    const asset = makeAsset('green-photo', 35, 156, 94)

    const result = buildMosaicPlacements(cells, [asset])

    expect(result.placements[0]?.cell.id).toBe('green-zone')
  })
})

describe('mergeMosaicAssets', () => {
  it('keeps the latest processed version for the same photo', () => {
    const first = makeAsset('photo-1', 28, 120, 84, '2026-04-13T18:00:00.000Z')
    const newer = makeAsset('photo-1', 30, 122, 86, '2026-04-13T18:01:00.000Z')
    const merged = mergeMosaicAssets([first], [newer])

    expect(merged).toHaveLength(1)
    expect(merged[0]?.avgRgb).toEqual(newer.avgRgb)
  })
})
