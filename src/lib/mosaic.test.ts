import { describe, expect, it } from 'vitest'
import { buildMosaicPlacements, mergeMosaicAssets } from './mosaic'
import type { MosaicAsset, MosaicCell } from '../types/mosaic'

function makeCell(
  id: string,
  red: number,
  green: number,
  blue: number,
  row = 0,
  column = 0,
): MosaicCell {
  return {
    id,
    row,
    column,
    x: column,
    y: row,
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
      makeCell('green-zone', 30, 160, 90, 0, 0),
      makeCell('blue-zone', 20, 30, 90, 0, 1),
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
      makeCell('green-zone', 30, 160, 90, 0, 0),
      makeCell('blue-zone', 20, 30, 90, 0, 1),
    ]
    const asset = makeAsset('green-photo', 35, 156, 94)

    const result = buildMosaicPlacements(cells, [asset])

    expect(result.placements[0]?.cell.id).toBe('green-zone')
    expect(result.placements[0]?.kind).toBe('original')
    expect(result.placements[0]?.placementId).toBe('original:green-photo')
  })

  it('fills every empty cell with reused assets when autofill is enabled', () => {
    const cells = [
      makeCell('cell-0-0', 30, 160, 90, 0, 0),
      makeCell('cell-0-1', 26, 36, 95, 0, 1),
      makeCell('cell-1-0', 32, 150, 88, 1, 0),
    ]
    const assets = [makeAsset('only-photo', 30, 158, 91)]

    const result = buildMosaicPlacements(cells, assets, {
      autoFillEmpty: true,
    })

    expect(result.placements).toHaveLength(cells.length)
    expect(result.placements.filter((placement) => placement.kind === 'reused'))
      .toHaveLength(2)
    expect(result.cells.every((cell) => cell.occupiedByPhotoId)).toBe(true)
  })

  it('only creates reused placements from existing assets and keeps ids unique', () => {
    const cells = [
      makeCell('cell-0-0', 30, 160, 90, 0, 0),
      makeCell('cell-0-1', 31, 159, 91, 0, 1),
      makeCell('cell-1-0', 29, 161, 89, 1, 0),
    ]
    const assets = [makeAsset('photo-a', 30, 160, 90)]

    const result = buildMosaicPlacements(cells, assets, {
      autoFillEmpty: true,
    })
    const placementIds = result.placements.map((placement) => placement.placementId)
    const reusedPhotoIds = result.placements
      .filter((placement) => placement.kind === 'reused')
      .map((placement) => placement.asset.photoId)

    expect(new Set(placementIds).size).toBe(placementIds.length)
    expect(reusedPhotoIds).toEqual(['photo-a', 'photo-a'])
  })

  it('spreads reused placements to avoid obvious adjacent repetition when choices are similar', () => {
    const cells = [
      makeCell('cell-0-0', 110, 110, 110, 0, 0),
      makeCell('cell-0-1', 110, 110, 110, 0, 1),
      makeCell('cell-0-2', 110, 110, 110, 0, 2),
      makeCell('cell-0-3', 110, 110, 110, 0, 3),
    ]
    const assets = [
      makeAsset('photo-a', 110, 110, 110),
      makeAsset('photo-b', 110, 110, 110, '2026-04-13T18:05:00.000Z'),
    ]

    const result = buildMosaicPlacements(cells, assets, {
      autoFillEmpty: true,
    })
    const orderedPhotoIds = result.placements
      .sort((left, right) => left.cell.column - right.cell.column)
      .map((placement) => placement.asset.photoId)

    expect(orderedPhotoIds).toEqual(['photo-a', 'photo-b', 'photo-a', 'photo-b'])
  })

  it('returns the same placement order for the same inputs', () => {
    const cells = [
      makeCell('cell-0-0', 30, 160, 90, 0, 0),
      makeCell('cell-0-1', 20, 30, 90, 0, 1),
      makeCell('cell-0-2', 120, 92, 30, 0, 2),
      makeCell('cell-1-0', 22, 32, 94, 1, 0),
    ]
    const assets = [
      makeAsset('photo-a', 30, 158, 91),
      makeAsset('photo-b', 20, 32, 92, '2026-04-13T18:05:00.000Z'),
    ]

    const first = buildMosaicPlacements(cells, assets, { autoFillEmpty: true })
    const second = buildMosaicPlacements(cells, assets, { autoFillEmpty: true })

    expect(first.placements).toEqual(second.placements)
  })

  it('keeps placement results deterministic even when cell sizes are not uniform', () => {
    const cells = [
      {
        ...makeCell('cell-0-0', 28, 150, 92, 0, 0),
        width: 1.8,
        height: 1.2,
      },
      {
        ...makeCell('cell-0-1', 20, 34, 94, 0, 2),
        x: 2.1,
        width: 0.9,
        height: 1.2,
      },
      {
        ...makeCell('cell-1-0', 120, 96, 36, 2, 0),
        y: 2.4,
        width: 1.4,
        height: 0.8,
      },
    ]
    const assets = [
      makeAsset('photo-a', 28, 149, 91),
      makeAsset('photo-b', 19, 36, 95, '2026-04-13T18:05:00.000Z'),
      makeAsset('photo-c', 119, 97, 37, '2026-04-13T18:10:00.000Z'),
    ]

    const first = buildMosaicPlacements(cells, assets, { autoFillEmpty: true })
    const second = buildMosaicPlacements(cells, assets, { autoFillEmpty: true })

    expect(first.placements).toEqual(second.placements)
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
