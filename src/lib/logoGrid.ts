import { lumaFromRgb } from './color'
import type { LogoGrid, MosaicCell, RGB } from '../types/mosaic'
import { renderWordmarkRaster } from './wordmarkRenderer'

const TARGET_ACTIVE_CELLS = 1500
const MIN_BASE_COLUMNS = 11
const MAX_BASE_COLUMNS = 48
const MASK_ALPHA_THRESHOLD = 128
const WORDMARK_MASK_ALPHA_THRESHOLD = 10
const WORDMARK_MASK_PADDING_PX = 3
const DISCARD_COVERAGE = 0.06
const ISOTYPE_ACTIVE_COVERAGE = 0.45
const ISOTYPE_DIRECT_ACCEPT_COVERAGE = 0.95
const WORDMARK_ACTIVE_COVERAGE = 0.10
const WORDMARK_DIRECT_ACCEPT_COVERAGE = 0.92
const ISOTYPE_COMPONENT_COUNT = 2
const GENERAL_MAX_SUBDIVISION_DEPTH = 2
const ISOTYPE_MAX_SUBDIVISION_DEPTH = 5
const WORDMARK_MAX_SUBDIVISION_DEPTH = 4
const GRID_LATTICE_SCALE = 1 << Math.max(ISOTYPE_MAX_SUBDIVISION_DEPTH, WORDMARK_MAX_SUBDIVISION_DEPTH)

const DEFAULT_WORDMARK_TEXT = 'EMBLAVEO'
const DEFAULT_FONT_FAMILY = 'Montserrat'
const DEFAULT_FONT_WEIGHT = 700
const DEFAULT_WORDMARK_HEIGHT_RATIO = 0.48
const DEFAULT_LETTER_SPACING_EM = 0.12
const DEFAULT_GAP_RATIO = 0.18

export type RasterSource = {
  width: number
  height: number
  data: Uint8ClampedArray
}

type Bounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

type DetectedComponent = Bounds & {
  id: number
  pixelCount: number
  pixels: number[]
}

type ComponentKind = 'isotype' | 'wordmark'

type RegionConfig = {
  kind: ComponentKind
  bounds: Bounds
  maxDepth: number
  directAcceptCoverage: number
  activeCoverage: number
}

type RasterSampler = {
  sample: (x: number, y: number, width: number, height: number) => Sample
}

type Sample = {
  color: RGB
  coverage: number
  luma: number
}

type RasterWithMask = RasterSource & { mask: Uint8ClampedArray }

export type IsotipoExtraction = {
  raster: RasterWithMask
  wordmarkColor: RGB
}

export type NormalizedLogoRaster = RasterWithMask & {
  isotypeBounds: Bounds
  wordmarkBounds: Bounds
  regionConfigs: RegionConfig[]
}

export type BuildLogoGridOptions = {
  wordmarkText: string
  fontFamily: string
  fontWeight: number
  wordmarkHeightRatio: number
  letterSpacingEm: number
  gapRatio: number
  wordmarkColor?: RGB
}

type MaskExtractionOptions = {
  alphaThreshold?: number
  paddingPx?: number
}

function compareBounds(left: Bounds, right: Bounds) {
  if (left.minX !== right.minX) {
    return left.minX - right.minX
  }

  return left.minY - right.minY
}

function compareComponentArea(left: DetectedComponent, right: DetectedComponent) {
  if (left.pixelCount !== right.pixelCount) {
    return right.pixelCount - left.pixelCount
  }

  if (left.width !== right.width) {
    return right.width - left.width
  }

  return compareBounds(left, right)
}

function compareCells(left: MosaicCell, right: MosaicCell) {
  if (left.row !== right.row) {
    return left.row - right.row
  }

  if (left.column !== right.column) {
    return left.column - right.column
  }

  if (left.y !== right.y) {
    return left.y - right.y
  }

  return left.x - right.x
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error('No se pudo cargar el asset base del logo.'))
    image.src = src
  })
}

function createBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Bounds {
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

function rectangleIntersects(
  left: { x: number; y: number; width: number; height: number },
  right: Bounds,
) {
  return !(
    left.x + left.width <= right.minX ||
    left.x >= right.maxX + 1 ||
    left.y + left.height <= right.minY ||
    left.y >= right.maxY + 1
  )
}

function rectSum(
  integral: Float64Array,
  stride: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  const topLeft = minY * stride + minX
  const topRight = minY * stride + maxX
  const bottomLeft = maxY * stride + minX
  const bottomRight = maxY * stride + maxX

  return (
    integral[bottomRight] -
    integral[topRight] -
    integral[bottomLeft] +
    integral[topLeft]
  )
}

export function extractSolidLogoMask(
  source: RasterSource,
  options: MaskExtractionOptions = {},
) {
  const alphaThreshold = options.alphaThreshold ?? MASK_ALPHA_THRESHOLD
  const paddingPx = Math.max(0, Math.floor(options.paddingPx ?? 0))
  const mask = new Uint8ClampedArray(source.width * source.height)
  let minX = source.width
  let minY = source.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const pixelIndex = y * source.width + x
      const alpha = source.data[pixelIndex * 4 + 3]

      if (alpha < alphaThreshold) {
        continue
      }

      mask[pixelIndex] = 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < 0 || maxY < 0) {
    throw new Error('El logo no tiene suficiente geometria solida.')
  }

  return {
    width: source.width,
    height: source.height,
    data: source.data,
    mask,
    bounds: createBounds(
      Math.max(0, minX - paddingPx),
      Math.max(0, minY - paddingPx),
      Math.min(source.width - 1, maxX + paddingPx),
      Math.min(source.height - 1, maxY + paddingPx),
    ),
  }
}

function cropRaster(
  source: RasterSource,
  mask: Uint8ClampedArray,
  bounds: Bounds,
): RasterWithMask {
  const data = new Uint8ClampedArray(bounds.width * bounds.height * 4)
  const croppedMask = new Uint8ClampedArray(bounds.width * bounds.height)

  for (let y = 0; y < bounds.height; y += 1) {
    const sourceY = bounds.minY + y

    for (let x = 0; x < bounds.width; x += 1) {
      const sourceX = bounds.minX + x
      const sourcePixelIndex = sourceY * source.width + sourceX
      const targetPixelIndex = y * bounds.width + x

      croppedMask[targetPixelIndex] = mask[sourcePixelIndex]

      const sourceOffset = sourcePixelIndex * 4
      const targetOffset = targetPixelIndex * 4
      data[targetOffset] = source.data[sourceOffset]
      data[targetOffset + 1] = source.data[sourceOffset + 1]
      data[targetOffset + 2] = source.data[sourceOffset + 2]
      data[targetOffset + 3] = source.data[sourceOffset + 3]
    }
  }

  return {
    width: bounds.width,
    height: bounds.height,
    data,
    mask: croppedMask,
  }
}

function collectConnectedComponents(
  mask: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const visited = new Uint8ClampedArray(mask.length)
  const stack: number[] = []
  const components: DetectedComponent[] = []

  for (let startIndex = 0; startIndex < mask.length; startIndex += 1) {
    if (!mask[startIndex] || visited[startIndex]) {
      continue
    }

    visited[startIndex] = 1
    stack.push(startIndex)

    let pixelCount = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1
    const pixels: number[] = []

    while (stack.length > 0) {
      const currentIndex = stack.pop()

      if (currentIndex === undefined) {
        continue
      }

      const x = currentIndex % width
      const y = Math.floor(currentIndex / width)

      pixelCount += 1
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      pixels.push(currentIndex)

      const leftIndex = currentIndex - 1
      if (x > 0 && mask[leftIndex] && !visited[leftIndex]) {
        visited[leftIndex] = 1
        stack.push(leftIndex)
      }

      const rightIndex = currentIndex + 1
      if (x + 1 < width && mask[rightIndex] && !visited[rightIndex]) {
        visited[rightIndex] = 1
        stack.push(rightIndex)
      }

      const topIndex = currentIndex - width
      if (y > 0 && mask[topIndex] && !visited[topIndex]) {
        visited[topIndex] = 1
        stack.push(topIndex)
      }

      const bottomIndex = currentIndex + width
      if (y + 1 < height && mask[bottomIndex] && !visited[bottomIndex]) {
        visited[bottomIndex] = 1
        stack.push(bottomIndex)
      }
    }

    components.push({
      id: components.length,
      pixelCount,
      pixels,
      ...createBounds(minX, minY, maxX, maxY),
    })
  }

  return components
}

function averageComponentColor(
  source: RasterWithMask,
  components: DetectedComponent[],
): RGB {
  let redSum = 0
  let greenSum = 0
  let blueSum = 0
  let weight = 0

  for (const component of components) {
    for (const pixelIndex of component.pixels) {
      const offset = pixelIndex * 4
      const alpha = source.data[offset + 3] / 255
      redSum += source.data[offset] * alpha
      greenSum += source.data[offset + 1] * alpha
      blueSum += source.data[offset + 2] * alpha
      weight += alpha
    }
  }

  if (weight === 0) {
    return { r: 26, g: 36, b: 84 }
  }

  return {
    r: Math.round(redSum / weight),
    g: Math.round(greenSum / weight),
    b: Math.round(blueSum / weight),
  }
}

function paintComponentsToRaster(
  source: RasterWithMask,
  components: DetectedComponent[],
  targetBounds: Bounds,
): RasterWithMask {
  const width = targetBounds.width
  const height = targetBounds.height
  const data = new Uint8ClampedArray(width * height * 4)
  const mask = new Uint8ClampedArray(width * height)

  for (const component of components) {
    for (const pixelIndex of component.pixels) {
      const sourceX = pixelIndex % source.width
      const sourceY = Math.floor(pixelIndex / source.width)
      const targetX = sourceX - targetBounds.minX
      const targetY = sourceY - targetBounds.minY

      if (
        targetX < 0 ||
        targetY < 0 ||
        targetX >= width ||
        targetY >= height
      ) {
        continue
      }

      const targetIndex = targetY * width + targetX
      const sourceOffset = pixelIndex * 4
      const targetOffset = targetIndex * 4

      data[targetOffset] = source.data[sourceOffset]
      data[targetOffset + 1] = source.data[sourceOffset + 1]
      data[targetOffset + 2] = source.data[sourceOffset + 2]
      data[targetOffset + 3] = source.data[sourceOffset + 3]
      mask[targetIndex] = 1
    }
  }

  return { width, height, data, mask }
}

function createRasterSampler(raster: RasterWithMask): RasterSampler {
  const stride = raster.width + 1
  const integralLength = stride * (raster.height + 1)
  const coverageIntegral = new Float64Array(integralLength)
  const weightIntegral = new Float64Array(integralLength)
  const redIntegral = new Float64Array(integralLength)
  const greenIntegral = new Float64Array(integralLength)
  const blueIntegral = new Float64Array(integralLength)

  for (let y = 0; y < raster.height; y += 1) {
    let coverageRow = 0
    let weightRow = 0
    let redRow = 0
    let greenRow = 0
    let blueRow = 0

    for (let x = 0; x < raster.width; x += 1) {
      const pixelIndex = y * raster.width + x
      const dataIndex = pixelIndex * 4
      const active = raster.mask[pixelIndex] ? 1 : 0
      const weight = active ? raster.data[dataIndex + 3] / 255 : 0

      coverageRow += active
      weightRow += weight
      redRow += raster.data[dataIndex] * weight
      greenRow += raster.data[dataIndex + 1] * weight
      blueRow += raster.data[dataIndex + 2] * weight

      const integralIndex = (y + 1) * stride + (x + 1)
      const aboveIndex = y * stride + (x + 1)
      coverageIntegral[integralIndex] = coverageIntegral[aboveIndex] + coverageRow
      weightIntegral[integralIndex] = weightIntegral[aboveIndex] + weightRow
      redIntegral[integralIndex] = redIntegral[aboveIndex] + redRow
      greenIntegral[integralIndex] = greenIntegral[aboveIndex] + greenRow
      blueIntegral[integralIndex] = blueIntegral[aboveIndex] + blueRow
    }
  }

  return {
    sample: (x, y, width, height) => {
      const minX = Math.max(0, Math.floor(x))
      const minY = Math.max(0, Math.floor(y))
      const maxX = Math.min(raster.width, Math.ceil(x + width))
      const maxY = Math.min(raster.height, Math.ceil(y + height))
      const sampleWidth = Math.max(1, maxX - minX)
      const sampleHeight = Math.max(1, maxY - minY)
      const area = sampleWidth * sampleHeight
      const coverage = rectSum(
        coverageIntegral,
        stride,
        minX,
        minY,
        maxX,
        maxY,
      ) / area
      const weight = rectSum(weightIntegral, stride, minX, minY, maxX, maxY)

      if (weight === 0) {
        return {
          color: { r: 0, g: 0, b: 0 },
          coverage,
          luma: 0,
        }
      }

      const color = {
        r: Math.round(rectSum(redIntegral, stride, minX, minY, maxX, maxY) / weight),
        g: Math.round(
          rectSum(greenIntegral, stride, minX, minY, maxX, maxY) / weight,
        ),
        b: Math.round(
          rectSum(blueIntegral, stride, minX, minY, maxX, maxY) / weight,
        ),
      }

      return {
        color,
        coverage,
        luma: lumaFromRgb(color),
      }
    },
  }
}

export function extractIsotipoRaster(source: RasterSource): IsotipoExtraction {
  const solid = extractSolidLogoMask(source)
  const cropped = cropRaster(
    { width: solid.width, height: solid.height, data: solid.data },
    solid.mask,
    solid.bounds,
  )
  const components = collectConnectedComponents(
    cropped.mask,
    cropped.width,
    cropped.height,
  )
  const ranked = [...components].sort(compareComponentArea)
  const isotypeComponents = ranked
    .slice(0, ISOTYPE_COMPONENT_COUNT)
    .sort(compareBounds)
  const nonIsotypeComponents = ranked.slice(ISOTYPE_COMPONENT_COUNT)

  if (isotypeComponents.length === 0) {
    throw new Error('No se detectó el isotipo en el logo original.')
  }

  const isotypeBounds = isotypeComponents.reduce<Bounds>((accumulator, component, index) => {
    if (index === 0) {
      return createBounds(
        component.minX,
        component.minY,
        component.maxX,
        component.maxY,
      )
    }

    return createBounds(
      Math.min(accumulator.minX, component.minX),
      Math.min(accumulator.minY, component.minY),
      Math.max(accumulator.maxX, component.maxX),
      Math.max(accumulator.maxY, component.maxY),
    )
  }, createBounds(0, 0, 0, 0))

  const isotypeRaster = paintComponentsToRaster(
    cropped,
    isotypeComponents,
    isotypeBounds,
  )
  const wordmarkColor =
    nonIsotypeComponents.length > 0
      ? averageComponentColor(cropped, nonIsotypeComponents)
      : averageComponentColor(cropped, isotypeComponents)

  return {
    raster: isotypeRaster,
    wordmarkColor,
  }
}

export function composeLogoRaster(
  isotypeExtraction: IsotipoExtraction,
  wordmarkRaster: RasterSource,
  options: { gapPx?: number } = {},
): NormalizedLogoRaster {
  const gap = Math.max(0, Math.round(options.gapPx ?? 16))
  const wordmarkSolid = extractSolidLogoMask(wordmarkRaster, {
    alphaThreshold: WORDMARK_MASK_ALPHA_THRESHOLD,
    paddingPx: WORDMARK_MASK_PADDING_PX,
  })
  const wordmarkCropped = cropRaster(
    {
      width: wordmarkRaster.width,
      height: wordmarkRaster.height,
      data: wordmarkRaster.data,
    },
    wordmarkSolid.mask,
    wordmarkSolid.bounds,
  )

  const isotypeRaster = isotypeExtraction.raster
  const compositeWidth = isotypeRaster.width + gap + wordmarkCropped.width
  const compositeHeight = Math.max(isotypeRaster.height, wordmarkCropped.height)
  const data = new Uint8ClampedArray(compositeWidth * compositeHeight * 4)
  const mask = new Uint8ClampedArray(compositeWidth * compositeHeight)

  const isotypeOriginX = 0
  const isotypeOriginY = Math.round(
    (compositeHeight - isotypeRaster.height) / 2,
  )
  const wordmarkOriginX = isotypeRaster.width + gap
  const wordmarkOriginY = Math.round(
    (compositeHeight - wordmarkCropped.height) / 2,
  )

  const pasteRaster = (
    raster: RasterWithMask,
    originX: number,
    originY: number,
  ) => {
    for (let y = 0; y < raster.height; y += 1) {
      for (let x = 0; x < raster.width; x += 1) {
        const sourceIndex = y * raster.width + x

        if (!raster.mask[sourceIndex]) {
          continue
        }

        const targetX = originX + x
        const targetY = originY + y
        const targetIndex = targetY * compositeWidth + targetX
        const sourceOffset = sourceIndex * 4
        const targetOffset = targetIndex * 4

        data[targetOffset] = raster.data[sourceOffset]
        data[targetOffset + 1] = raster.data[sourceOffset + 1]
        data[targetOffset + 2] = raster.data[sourceOffset + 2]
        data[targetOffset + 3] = raster.data[sourceOffset + 3]
        mask[targetIndex] = 1
      }
    }
  }

  pasteRaster(isotypeRaster, isotypeOriginX, isotypeOriginY)
  pasteRaster(wordmarkCropped, wordmarkOriginX, wordmarkOriginY)

  const isotypeBounds = createBounds(
    isotypeOriginX,
    isotypeOriginY,
    isotypeOriginX + isotypeRaster.width - 1,
    isotypeOriginY + isotypeRaster.height - 1,
  )
  const wordmarkBounds = createBounds(
    wordmarkOriginX,
    wordmarkOriginY,
    wordmarkOriginX + wordmarkCropped.width - 1,
    wordmarkOriginY + wordmarkCropped.height - 1,
  )

  const regionConfigs: RegionConfig[] = [
    {
      kind: 'isotype',
      bounds: isotypeBounds,
      maxDepth: ISOTYPE_MAX_SUBDIVISION_DEPTH,
      directAcceptCoverage: ISOTYPE_DIRECT_ACCEPT_COVERAGE,
      activeCoverage: ISOTYPE_ACTIVE_COVERAGE,
    },
    {
      kind: 'wordmark',
      bounds: wordmarkBounds,
      maxDepth: WORDMARK_MAX_SUBDIVISION_DEPTH,
      directAcceptCoverage: WORDMARK_DIRECT_ACCEPT_COVERAGE,
      activeCoverage: WORDMARK_ACTIVE_COVERAGE,
    },
  ]

  return {
    width: compositeWidth,
    height: compositeHeight,
    data,
    mask,
    isotypeBounds,
    wordmarkBounds,
    regionConfigs,
  }
}

function resolveRegionConfig(
  raster: NormalizedLogoRaster,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const intersectingRegions = raster.regionConfigs.filter((config) =>
    rectangleIntersects({ x, y, width, height }, config.bounds),
  )

  if (intersectingRegions.length === 0) {
    return {
      maxDepth: GENERAL_MAX_SUBDIVISION_DEPTH,
      directAcceptCoverage: ISOTYPE_DIRECT_ACCEPT_COVERAGE,
      activeCoverage: ISOTYPE_ACTIVE_COVERAGE,
    }
  }

  return intersectingRegions.sort((left, right) => {
    if (left.maxDepth !== right.maxDepth) {
      return right.maxDepth - left.maxDepth
    }

    if (left.directAcceptCoverage !== right.directAcceptCoverage) {
      return right.directAcceptCoverage - left.directAcceptCoverage
    }

    return left.activeCoverage - right.activeCoverage
  })[0]
}

function generateAdaptiveGrid(
  raster: NormalizedLogoRaster,
  baseColumns: number,
) {
  const baseRows = Math.max(1, Math.round((baseColumns * raster.height) / raster.width))
  const baseCellWidth = raster.width / baseColumns
  const baseCellHeight = raster.height / baseRows
  const sampler = createRasterSampler(raster)
  const cells: MosaicCell[] = []

  const visitCell = (
    baseRow: number,
    baseColumn: number,
    x: number,
    y: number,
    width: number,
    height: number,
    depth: number,
    latticeRow: number,
    latticeColumn: number,
    spanUnits: number,
  ) => {
    const sample = sampler.sample(x, y, width, height)

    if (sample.coverage < DISCARD_COVERAGE) {
      return
    }

    const regionConfig = resolveRegionConfig(raster, x, y, width, height)

    if (depth < regionConfig.maxDepth && sample.coverage < regionConfig.directAcceptCoverage) {
      const childWidth = width / 2
      const childHeight = height / 2
      const childSpan = spanUnits / 2

      visitCell(
        baseRow,
        baseColumn,
        x,
        y,
        childWidth,
        childHeight,
        depth + 1,
        latticeRow,
        latticeColumn,
        childSpan,
      )
      visitCell(
        baseRow,
        baseColumn,
        x + childWidth,
        y,
        childWidth,
        childHeight,
        depth + 1,
        latticeRow,
        latticeColumn + childSpan,
        childSpan,
      )
      visitCell(
        baseRow,
        baseColumn,
        x,
        y + childHeight,
        childWidth,
        childHeight,
        depth + 1,
        latticeRow + childSpan,
        latticeColumn,
        childSpan,
      )
      visitCell(
        baseRow,
        baseColumn,
        x + childWidth,
        y + childHeight,
        childWidth,
        childHeight,
        depth + 1,
        latticeRow + childSpan,
        latticeColumn + childSpan,
        childSpan,
      )
      return
    }

    if (sample.coverage < regionConfig.activeCoverage) {
      return
    }

    cells.push({
      id: `cell-${baseRow}-${baseColumn}-${depth}-${latticeRow}-${latticeColumn}`,
      row: latticeRow + Math.floor(spanUnits / 2),
      column: latticeColumn + Math.floor(spanUnits / 2),
      x,
      y,
      width,
      height,
      targetRgb: sample.color,
      targetLuma: sample.luma,
      alphaCoverage: sample.coverage,
      occupiedByPhotoId: null,
    })
  }

  for (let row = 0; row < baseRows; row += 1) {
    for (let column = 0; column < baseColumns; column += 1) {
      visitCell(
        row,
        column,
        column * baseCellWidth,
        row * baseCellHeight,
        baseCellWidth,
        baseCellHeight,
        0,
        row * GRID_LATTICE_SCALE,
        column * GRID_LATTICE_SCALE,
        GRID_LATTICE_SCALE,
      )
    }
  }

  cells.sort(compareCells)

  return {
    width: raster.width,
    height: raster.height,
    columns: baseColumns * GRID_LATTICE_SCALE,
    rows: baseRows * GRID_LATTICE_SCALE,
    cells,
  } satisfies LogoGrid
}

export function buildLogoGridFromNormalized(raster: NormalizedLogoRaster) {
  const cache = new Map<number, LogoGrid>()
  let best: LogoGrid | null = null

  for (let columns = MIN_BASE_COLUMNS; columns <= MAX_BASE_COLUMNS; columns += 1) {
    const cached = cache.get(columns)
    const grid = cached ?? generateAdaptiveGrid(raster, columns)
    cache.set(columns, grid)

    if (
      !best ||
      Math.abs(grid.cells.length - TARGET_ACTIVE_CELLS) <
        Math.abs(best.cells.length - TARGET_ACTIVE_CELLS)
    ) {
      best = grid
    }
  }

  if (!best) {
    throw new Error('No se pudo construir la malla del logo.')
  }

  return best
}

export function buildLogoGridFromRasters(
  pngRaster: RasterSource,
  wordmarkRaster: RasterSource,
  options: { gapPx?: number } = {},
) {
  const isotypeExtraction = extractIsotipoRaster(pngRaster)
  const normalized = composeLogoRaster(isotypeExtraction, wordmarkRaster, options)
  return buildLogoGridFromNormalized(normalized)
}

async function loadImageRaster(source: string): Promise<RasterSource> {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    throw new Error('No se pudo inicializar el lienzo del logo.')
  }

  context.drawImage(image, 0, 0)
  const imageData = context.getImageData(0, 0, image.naturalWidth, image.naturalHeight)

  return {
    width: imageData.width,
    height: imageData.height,
    data: imageData.data,
  }
}

function rgbToCssColor(color: RGB): string {
  return `rgb(${color.r}, ${color.g}, ${color.b})`
}

export async function buildLogoGrid(
  source: string,
  overrides: Partial<BuildLogoGridOptions> = {},
): Promise<LogoGrid> {
  const options: BuildLogoGridOptions = {
    wordmarkText: overrides.wordmarkText ?? DEFAULT_WORDMARK_TEXT,
    fontFamily: overrides.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontWeight: overrides.fontWeight ?? DEFAULT_FONT_WEIGHT,
    wordmarkHeightRatio:
      overrides.wordmarkHeightRatio ?? DEFAULT_WORDMARK_HEIGHT_RATIO,
    letterSpacingEm: overrides.letterSpacingEm ?? DEFAULT_LETTER_SPACING_EM,
    gapRatio: overrides.gapRatio ?? DEFAULT_GAP_RATIO,
    wordmarkColor: overrides.wordmarkColor,
  }

  const pngRaster = await loadImageRaster(source)
  const isotypeExtraction = extractIsotipoRaster(pngRaster)
  const isotypeHeight = isotypeExtraction.raster.height
  const isotypeWidth = isotypeExtraction.raster.width

  const targetCapHeightPx = Math.max(
    16,
    Math.round(isotypeHeight * options.wordmarkHeightRatio),
  )
  const fontSize = Math.round(targetCapHeightPx / 0.72)
  const letterSpacingPx = Math.round(fontSize * options.letterSpacingEm)
  const gapPx = Math.max(6, Math.round(isotypeWidth * options.gapRatio))
  const color = options.wordmarkColor ?? isotypeExtraction.wordmarkColor

  const wordmarkRaster = await renderWordmarkRaster({
    text: options.wordmarkText,
    fontFamily: options.fontFamily,
    fontWeight: options.fontWeight,
    fontSize,
    letterSpacingPx,
    color: rgbToCssColor(color),
  })

  const normalized = composeLogoRaster(isotypeExtraction, wordmarkRaster, {
    gapPx,
  })
  return buildLogoGridFromNormalized(normalized)
}
