import { colorDistance } from './color'
import type { MosaicAsset, MosaicCell, MosaicPlacement } from '../types/mosaic'

const REUSE_TOP_CANDIDATE_COUNT = 12
const REUSE_USAGE_PENALTY = 16
const REUSE_PROXIMITY_RADIUS = 6
const REUSE_PROXIMITY_PENALTY = 24

export type BuildMosaicPlacementsOptions = {
  autoFillEmpty?: boolean
}

type ScoredAssetCandidate = {
  asset: MosaicAsset
  baseScore: number
}

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

function compareCells(left: MosaicCell, right: MosaicCell) {
  if (left.row !== right.row) {
    return left.row - right.row
  }

  return left.column - right.column
}

function deterministicHash(value: string) {
  let hash = 2166136261

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0) / 4294967295
}

function compareScoredCandidates(
  left: ScoredAssetCandidate,
  right: ScoredAssetCandidate,
) {
  if (left.baseScore !== right.baseScore) {
    return left.baseScore - right.baseScore
  }

  return compareAssets(left.asset, right.asset)
}

function markCellOccupied(cell: MosaicCell, photoId: string) {
  return {
    ...cell,
    occupiedByPhotoId: photoId,
  }
}

function buildPlacement(
  asset: MosaicAsset,
  cell: MosaicCell,
  slot: number,
  kind: MosaicPlacement['kind'],
): MosaicPlacement {
  return {
    placementId:
      kind === 'original'
        ? `original:${asset.photoId}`
        : `reused:${cell.id}:${asset.photoId}`,
    kind,
    asset,
    cell,
    slot,
  }
}

function manhattanDistance(left: MosaicCell, right: MosaicCell) {
  return Math.abs(left.row - right.row) + Math.abs(left.column - right.column)
}

function scoreReuseCandidate(
  candidate: ScoredAssetCandidate,
  cell: MosaicCell,
  placements: MosaicPlacement[],
  reuseCounts: Map<string, number>,
) {
  const usagePenalty =
    (reuseCounts.get(candidate.asset.photoId) ?? 0) * REUSE_USAGE_PENALTY

  let proximityPenalty = 0

  for (const placement of placements) {
    if (placement.asset.photoId !== candidate.asset.photoId) {
      continue
    }

    const distance = manhattanDistance(cell, placement.cell)
    proximityPenalty +=
      Math.max(0, REUSE_PROXIMITY_RADIUS - distance) * REUSE_PROXIMITY_PENALTY
  }

  const tieBreak =
    deterministicHash(`${cell.id}:${candidate.asset.photoId}`) * 0.001

  return candidate.baseScore + usagePenalty + proximityPenalty + tieBreak
}

function createScoredCandidates(cell: MosaicCell, assets: MosaicAsset[]) {
  return assets
    .map((asset) => ({
      asset,
      baseScore: scoreAssetForCell(asset, cell),
    }))
    .sort(compareScoredCandidates)
}

function fillEmptyCells(
  workingCells: MosaicCell[],
  assets: MosaicAsset[],
  placements: MosaicPlacement[],
) {
  if (assets.length === 0) {
    return
  }

  const reusableCandidates = Math.min(REUSE_TOP_CANDIDATE_COUNT, assets.length)
  const reuseCounts = new Map(assets.map((asset) => [asset.photoId, 0]))
  const emptyCells = workingCells.filter((cell) => !cell.occupiedByPhotoId)
  const rankedCells = emptyCells
    .map((cell) => {
      const bestBaseScore = createScoredCandidates(cell, assets)[0]?.baseScore ??
        Number.POSITIVE_INFINITY

      return {
        cell,
        bestBaseScore,
      }
    })
    .sort((left, right) => {
      if (left.bestBaseScore !== right.bestBaseScore) {
        return right.bestBaseScore - left.bestBaseScore
      }

      return compareCells(left.cell, right.cell)
    })

  for (const rankedCell of rankedCells) {
    const cellIndex = workingCells.findIndex((cell) => cell.id === rankedCell.cell.id)

    if (cellIndex === -1 || workingCells[cellIndex]?.occupiedByPhotoId) {
      continue
    }

    const cell = workingCells[cellIndex]
    const candidates = createScoredCandidates(cell, assets).slice(
      0,
      reusableCandidates,
    )

    if (candidates.length === 0) {
      continue
    }

    let bestCandidate = candidates[0]
    let bestScore = Number.POSITIVE_INFINITY

    for (const candidate of candidates) {
      const candidateScore = scoreReuseCandidate(
        candidate,
        cell,
        placements,
        reuseCounts,
      )

      if (candidateScore < bestScore) {
        bestCandidate = candidate
        bestScore = candidateScore
      }
    }

    workingCells[cellIndex] = markCellOccupied(cell, bestCandidate.asset.photoId)
    reuseCounts.set(
      bestCandidate.asset.photoId,
      (reuseCounts.get(bestCandidate.asset.photoId) ?? 0) + 1,
    )

    placements.push(
      buildPlacement(
        bestCandidate.asset,
        workingCells[cellIndex],
        placements.length,
        'reused',
      ),
    )
  }
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

export function buildMosaicPlacements(
  cells: MosaicCell[],
  assets: MosaicAsset[],
  options: BuildMosaicPlacementsOptions = {},
) {
  const orderedAssets = [...assets].sort(compareAssets)
  const workingCells = cells.map((cell) => ({ ...cell }))
  const placements: MosaicPlacement[] = []

  for (const asset of orderedAssets) {
    let bestIndex = -1
    let bestScore = Number.POSITIVE_INFINITY

    for (let index = 0; index < workingCells.length; index += 1) {
      const cell = workingCells[index]

      if (!cell || cell.occupiedByPhotoId) {
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

    workingCells[bestIndex] = markCellOccupied(workingCells[bestIndex], asset.photoId)

    placements.push(
      buildPlacement(asset, workingCells[bestIndex], placements.length, 'original'),
    )
  }

  if (options.autoFillEmpty) {
    fillEmptyCells(workingCells, orderedAssets, placements)
  }

  return {
    cells: workingCells,
    placements,
  }
}
