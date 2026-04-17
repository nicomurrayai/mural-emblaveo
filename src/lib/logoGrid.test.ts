import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  buildLogoGridFromRasters,
  composeLogoRaster,
  extractIsotipoRaster,
  extractSolidLogoMask,
} from './logoGrid'
import type { LogoGrid } from '../types/mosaic'

type FillOptions = {
  r?: number
  g?: number
  b?: number
  a?: number
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  options: FillOptions = {},
) {
  const { r = 255, g = 255, b = 255, a = 255 } = options

  for (let offsetY = 0; offsetY < rectHeight; offsetY += 1) {
    for (let offsetX = 0; offsetX < rectWidth; offsetX += 1) {
      const pixelIndex = (y + offsetY) * width + (x + offsetX)
      const dataIndex = pixelIndex * 4

      data[dataIndex] = r
      data[dataIndex + 1] = g
      data[dataIndex + 2] = b
      data[dataIndex + 3] = a
    }
  }
}

type BoundsLike = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function rectIntersectsCell(
  bounds: BoundsLike | null,
  cell: { x: number; y: number; width: number; height: number },
) {
  if (!bounds) {
    return false
  }

  return !(
    cell.x + cell.width <= bounds.minX ||
    cell.x >= bounds.maxX + 1 ||
    cell.y + cell.height <= bounds.minY ||
    cell.y >= bounds.maxY + 1
  )
}

function countIntersectingCells(grid: LogoGrid, bounds: BoundsLike | null) {
  return grid.cells.filter((cell) => rectIntersectsCell(bounds, cell)).length
}

function makeSyntheticIsotipoPng() {
  const width = 90
  const height = 50
  const data = new Uint8ClampedArray(width * height * 4)

  fillRect(data, width, 5, 10, 20, 30, { r: 20, g: 168, b: 116 })
  fillRect(data, width, 28, 8, 22, 32, { r: 30, g: 42, b: 104 })

  for (let index = 0; index < 3; index += 1) {
    fillRect(data, width, 58 + index * 6, 18, 4, 14, {
      r: 28,
      g: 38,
      b: 96,
    })
  }

  return { width, height, data }
}

function makeSyntheticWordmarkRaster() {
  const width = 140
  const height = 36
  const data = new Uint8ClampedArray(width * height * 4)

  for (let index = 0; index < 8; index += 1) {
    fillRect(data, width, 6 + index * 16, 6, 10, 24, {
      r: 28,
      g: 40,
      b: 100,
    })
  }

  return { width, height, data }
}

function makeSoftCornerWordmarkRaster() {
  const width = 28
  const height = 18
  const data = new Uint8ClampedArray(width * height * 4)

  fillRect(data, width, 6, 4, 14, 10, { r: 28, g: 40, b: 100 })
  fillRect(data, width, 5, 3, 1, 1, { r: 28, g: 40, b: 100, a: 24 })
  fillRect(data, width, 20, 3, 1, 1, { r: 28, g: 40, b: 100, a: 24 })

  return { width, height, data }
}

describe('extractSolidLogoMask', () => {
  it('recorta los margenes transparentes usando solo la geometria solida', () => {
    const width = 10
    const height = 8
    const data = new Uint8ClampedArray(width * height * 4)

    fillRect(data, width, 2, 1, 4, 4, { r: 40, g: 120, b: 80 })

    const result = extractSolidLogoMask({ width, height, data })

    expect(result.bounds).toEqual({
      minX: 2,
      minY: 1,
      maxX: 5,
      maxY: 4,
      width: 4,
      height: 4,
    })
  })

  it('permite incluir bordes suaves con un umbral de alpha mas bajo y padding', () => {
    const width = 8
    const height = 8
    const data = new Uint8ClampedArray(width * height * 4)

    fillRect(data, width, 3, 3, 3, 3, { r: 40, g: 120, b: 80 })
    fillRect(data, width, 2, 2, 1, 1, { r: 40, g: 120, b: 80, a: 20 })

    const result = extractSolidLogoMask(
      { width, height, data },
      { alphaThreshold: 16, paddingPx: 1 },
    )

    expect(result.bounds).toEqual({
      minX: 1,
      minY: 1,
      maxX: 6,
      maxY: 6,
      width: 6,
      height: 6,
    })
  })
})

describe('extractIsotipoRaster', () => {
  it('aisla los dos componentes mas grandes y descarta el resto', () => {
    const extraction = extractIsotipoRaster(makeSyntheticIsotipoPng())

    expect(extraction.raster.width).toBeGreaterThan(0)
    expect(extraction.raster.height).toBeGreaterThan(0)
    expect(extraction.raster.width).toBeLessThanOrEqual(50)
  })

  it('muestrea el color promedio del wordmark descartado', () => {
    const extraction = extractIsotipoRaster(makeSyntheticIsotipoPng())

    expect(extraction.wordmarkColor.r).toBe(28)
    expect(extraction.wordmarkColor.g).toBe(38)
    expect(extraction.wordmarkColor.b).toBe(96)
  })

  it('mantiene el isotipo real del logo con alto y ancho razonables', async () => {
    const assetPath = fileURLToPath(
      new URL('../assets/logo-primary.png', import.meta.url),
    )
    const { data, info } = await sharp(assetPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const raster = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      ),
    }

    const extraction = extractIsotipoRaster(raster)

    expect(extraction.raster.width).toBeGreaterThan(60)
    expect(extraction.raster.height).toBeGreaterThan(60)
    expect(extraction.raster.width).toBeLessThan(raster.width)
    expect(extraction.wordmarkColor.r).toBeLessThan(120)
    expect(extraction.wordmarkColor.b).toBeGreaterThan(50)
  })
})

describe('composeLogoRaster', () => {
  it('posiciona el isotipo a la izquierda y el wordmark a la derecha con gap', () => {
    const extraction = extractIsotipoRaster(makeSyntheticIsotipoPng())
    const wordmarkRaster = makeSyntheticWordmarkRaster()
    const composed = composeLogoRaster(extraction, wordmarkRaster, {
      gapPx: 12,
    })

    expect(composed.isotypeBounds.minX).toBe(0)
    expect(composed.wordmarkBounds.minX).toBe(
      composed.isotypeBounds.maxX + 1 + 12,
    )
    expect(composed.regionConfigs).toHaveLength(2)
    expect(composed.regionConfigs[0]?.kind).toBe('isotype')
    expect(composed.regionConfigs[1]?.kind).toBe('wordmark')
  })

  it('centra verticalmente isotipo y wordmark cuando tienen alturas distintas', () => {
    const extraction = extractIsotipoRaster(makeSyntheticIsotipoPng())
    const wordmarkRaster = makeSyntheticWordmarkRaster()
    const composed = composeLogoRaster(extraction, wordmarkRaster, {
      gapPx: 8,
    })

    const isotypeMidY =
      (composed.isotypeBounds.minY + composed.isotypeBounds.maxY) / 2
    const wordmarkMidY =
      (composed.wordmarkBounds.minY + composed.wordmarkBounds.maxY) / 2

    expect(Math.abs(isotypeMidY - wordmarkMidY)).toBeLessThanOrEqual(1)
  })

  it('preserva las esquinas suaves del wordmark para no recortar letras', () => {
    const extraction = extractIsotipoRaster(makeSyntheticIsotipoPng())
    const composed = composeLogoRaster(extraction, makeSoftCornerWordmarkRaster(), {
      gapPx: 8,
    })

    expect(composed.wordmarkBounds.width).toBeGreaterThanOrEqual(18)
    expect(composed.wordmarkBounds.height).toBeGreaterThanOrEqual(12)
  })
})

describe('buildLogoGridFromRasters', () => {
  it('produce celdas en ambas regiones usando inputs sinteticos', () => {
    const grid = buildLogoGridFromRasters(
      makeSyntheticIsotipoPng(),
      makeSyntheticWordmarkRaster(),
      { gapPx: 10 },
    )
    const extraction = extractIsotipoRaster(makeSyntheticIsotipoPng())
    const composed = composeLogoRaster(extraction, makeSyntheticWordmarkRaster(), {
      gapPx: 10,
    })

    const isotypeCells = countIntersectingCells(grid, composed.isotypeBounds)
    const wordmarkCells = countIntersectingCells(grid, composed.wordmarkBounds)

    expect(grid.cells.length).toBeGreaterThan(0)
    expect(isotypeCells).toBeGreaterThan(0)
    expect(wordmarkCells).toBeGreaterThan(0)
  })

  it('produce un numero razonable de celdas con el PNG real + wordmark sintetico', async () => {
    const assetPath = fileURLToPath(
      new URL('../assets/logo-primary.png', import.meta.url),
    )
    const { data, info } = await sharp(assetPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const raster = {
      width: info.width,
      height: info.height,
      data: new Uint8ClampedArray(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      ),
    }

    const wordmarkRaster = makeSyntheticWordmarkRaster()
    const grid = buildLogoGridFromRasters(raster, wordmarkRaster, {
      gapPx: 24,
    })
    const extraction = extractIsotipoRaster(raster)
    const composed = composeLogoRaster(extraction, wordmarkRaster, {
      gapPx: 24,
    })

    const isotypeCells = countIntersectingCells(grid, composed.isotypeBounds)
    const wordmarkCells = countIntersectingCells(grid, composed.wordmarkBounds)

    expect(isotypeCells).toBeGreaterThan(200)
    expect(wordmarkCells).toBeGreaterThan(0)
    expect(grid.cells.length).toBeGreaterThan(400)
    expect(grid.cells.length).toBeLessThan(2500)
  })
})
