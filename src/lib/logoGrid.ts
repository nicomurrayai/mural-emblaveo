import { lumaFromRgb } from './color'
import type { LogoGrid, MosaicCell, RGB } from '../types/mosaic'

const TARGET_ACTIVE_CELLS = 960
const MIN_COLUMNS = 70
const MAX_COLUMNS = 160
const MIN_COVERAGE = 0.24
const ALPHA_FLOOR = 24

type Sample = {
  color: RGB
  coverage: number
  luma: number
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

function sampleCell(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): Sample {
  const sampleX = Math.max(0, Math.floor(x))
  const sampleY = Math.max(0, Math.floor(y))
  const sampleWidth = Math.max(1, Math.ceil(width))
  const sampleHeight = Math.max(1, Math.ceil(height))
  const imageData = context.getImageData(
    sampleX,
    sampleY,
    sampleWidth,
    sampleHeight,
  ).data

  let weightedCount = 0
  let alphaPixels = 0
  let red = 0
  let green = 0
  let blue = 0

  for (let index = 0; index < imageData.length; index += 4) {
    const alpha = imageData[index + 3]

    if (alpha < ALPHA_FLOOR) {
      continue
    }

    const weight = alpha / 255
    weightedCount += weight
    alphaPixels += 1
    red += imageData[index] * weight
    green += imageData[index + 1] * weight
    blue += imageData[index + 2] * weight
  }

  if (weightedCount === 0) {
    return {
      color: { r: 0, g: 0, b: 0 },
      coverage: 0,
      luma: 0,
    }
  }

  const color = {
    r: Math.round(red / weightedCount),
    g: Math.round(green / weightedCount),
    b: Math.round(blue / weightedCount),
  }

  return {
    color,
    coverage: alphaPixels / (sampleWidth * sampleHeight),
    luma: lumaFromRgb(color),
  }
}

function generateGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  columns: number,
) {
  const rows = Math.max(1, Math.round((columns * height) / width))
  const cellWidth = width / columns
  const cellHeight = height / rows
  const cells: MosaicCell[] = []

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * cellWidth
      const y = row * cellHeight
      const sample = sampleCell(context, x, y, cellWidth, cellHeight)

      if (sample.coverage < MIN_COVERAGE) {
        continue
      }

      cells.push({
        id: `cell-${row}-${column}`,
        x,
        y,
        width: cellWidth,
        height: cellHeight,
        targetRgb: sample.color,
        targetLuma: sample.luma,
        alphaCoverage: sample.coverage,
        occupiedByPhotoId: null,
      })
    }
  }

  return {
    width,
    height,
    columns,
    rows,
    cells,
  } satisfies LogoGrid
}

export async function buildLogoGrid(source: string) {
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    throw new Error('No se pudo inicializar el lienzo del logo.')
  }

  context.drawImage(image, 0, 0)

  const cache = new Map<number, LogoGrid>()
  const measure = (columns: number) => {
    const cached = cache.get(columns)

    if (cached) {
      return cached
    }

    const grid = generateGrid(
      context,
      image.naturalWidth,
      image.naturalHeight,
      columns,
    )
    cache.set(columns, grid)
    return grid
  }

  let low = MIN_COLUMNS
  let high = MAX_COLUMNS
  let best = measure(Math.round((MIN_COLUMNS + MAX_COLUMNS) / 2))

  while (low <= high) {
    const middle = Math.round((low + high) / 2)
    const grid = measure(middle)

    if (
      Math.abs(grid.cells.length - TARGET_ACTIVE_CELLS) <
      Math.abs(best.cells.length - TARGET_ACTIVE_CELLS)
    ) {
      best = grid
    }

    if (grid.cells.length < TARGET_ACTIVE_CELLS) {
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return best
}
