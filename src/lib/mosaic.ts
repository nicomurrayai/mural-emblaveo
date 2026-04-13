import { colorDistance } from './color'
import type { MosaicAsset, MosaicCell, MosaicPlacement } from '../types/mosaic'

function compareAssets(left: MosaicAsset, right: MosaicAsset) {
  const createdDelta =
    Date.parse(left.createdAt || left.processedAt) -
    Date.parse(right.createdAt || right.processedAt)

  if (createdDelta !== 0) {
    return createdDelta
  }

  const processedDelta =
    Date.parse(left.processedAt) - Date.parse(right.processedAt)

  if (processedDelta !== 0) {
    return processedDelta
  }

  return left.photoId.localeCompare(right.photoId)
}

export function mergeMosaicAssets(
  existing: MosaicAsset[],
  incoming: MosaicAsset[],
) {
  const merged = new Map(existing.map((asset) => [asset.photoId, asset]))

  for (const asset of incoming) {
    const previous = merged.get(asset.photoId)

    if (
      !previous ||
      Date.parse(asset.processedAt) >= Date.parse(previous.processedAt)
    ) {
      merged.set(asset.photoId, asset)
    }
  }

  return [...merged.values()].sort(compareAssets)
}

export function scoreAssetForCell(asset: MosaicAsset, cell: MosaicCell) {
  const chromaGap = colorDistance(asset.avgRgb, cell.targetRgb)
  const lumaGap = Math.abs(asset.luma - cell.targetLuma)
  const coverageBias = (1 - cell.alphaCoverage) * 12

  return chromaGap * 0.82 + lumaGap * 0.24 + coverageBias
}

export function buildMosaicPlacements(cells: MosaicCell[], assets: MosaicAsset[]) {
  const orderedAssets = [...assets].sort(compareAssets)
  const workingCells = cells.map((cell) => ({ ...cell }))
  const placements: MosaicPlacement[] = []

  for (const asset of orderedAssets) {
    let bestIndex = -1
    let bestScore = Number.POSITIVE_INFINITY

    for (let index = 0; index < workingCells.length; index += 1) {
      const cell = workingCells[index]

      if (cell.occupiedByPhotoId) {
        continue
      }

      const score = scoreAssetForCell(asset, cell)

      if (score < bestScore) {
        bestScore = score
        bestIndex = index
      }
    }

    if (bestIndex === -1) {
      break
    }

    workingCells[bestIndex] = {
      ...workingCells[bestIndex],
      occupiedByPhotoId: asset.photoId,
    }

    placements.push({
      asset,
      cell: workingCells[bestIndex],
      slot: placements.length,
    })
  }

  return {
    cells: workingCells,
    placements,
  }
}
