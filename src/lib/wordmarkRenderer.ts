import type { RasterSource } from './logoGrid'

export type WordmarkRenderOptions = {
  text: string
  fontFamily: string
  fontWeight: number
  fontSize: number
  letterSpacingPx: number
  color: string
  paddingPx?: number
}

type CanvasWithLetterSpacing = CanvasRenderingContext2D & {
  letterSpacing?: string
  textRendering?: string
}

const SUPERSAMPLE_SCALE = 2

async function ensureFontReady(
  fontFamily: string,
  fontWeight: number,
  fontSize: number,
): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return
  }

  const specimen = `${fontWeight} ${fontSize}px "${fontFamily}"`
  await document.fonts.load(specimen)
}

export async function renderWordmarkRaster(
  options: WordmarkRenderOptions,
): Promise<RasterSource> {
  const { text, fontFamily, fontWeight, fontSize, letterSpacingPx, color } =
    options
  const padding =
    options.paddingPx ??
    Math.max(
      Math.ceil(fontSize * 0.18),
      Math.ceil(letterSpacingPx + fontSize * 0.06),
    )

  const hiFontSize = fontSize * SUPERSAMPLE_SCALE
  const hiLetterSpacing = letterSpacingPx * SUPERSAMPLE_SCALE
  const hiPadding = padding * SUPERSAMPLE_SCALE

  await ensureFontReady(fontFamily, fontWeight, hiFontSize)

  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext(
    '2d',
  ) as CanvasWithLetterSpacing | null

  if (!measureContext) {
    throw new Error('No se pudo inicializar el lienzo de medición del wordmark.')
  }

  measureContext.font = `${fontWeight} ${hiFontSize}px "${fontFamily}"`
  measureContext.letterSpacing = `${hiLetterSpacing}px`

  const metrics = measureContext.measureText(text)
  const textWidth = metrics.width
  const textLeft = metrics.actualBoundingBoxLeft ?? 0
  const textRight = metrics.actualBoundingBoxRight ?? textWidth
  const ascent =
    metrics.fontBoundingBoxAscent ??
    metrics.actualBoundingBoxAscent ??
    hiFontSize * 0.8
  const descent =
    metrics.fontBoundingBoxDescent ??
    metrics.actualBoundingBoxDescent ??
    hiFontSize * 0.2

  const capAscent =
    metrics.actualBoundingBoxAscent ?? ascent
  const capDescent =
    metrics.actualBoundingBoxDescent ?? descent

  const hiWidth = Math.max(1, Math.ceil(textLeft + textRight + hiPadding * 2 + 2))
  const hiHeight = Math.max(1, Math.ceil(capAscent + capDescent + hiPadding * 2))

  // --- Step 1: render at high resolution ---
  const hiCanvas = document.createElement('canvas')
  hiCanvas.width = hiWidth
  hiCanvas.height = hiHeight
  const hiContext = hiCanvas.getContext('2d', {
    willReadFrequently: true,
  }) as CanvasWithLetterSpacing | null

  if (!hiContext) {
    throw new Error('No se pudo inicializar el lienzo del wordmark.')
  }

  hiContext.clearRect(0, 0, hiWidth, hiHeight)
  hiContext.font = `${fontWeight} ${hiFontSize}px "${fontFamily}"`
  hiContext.letterSpacing = `${hiLetterSpacing}px`
  hiContext.textRendering = 'geometricPrecision'
  hiContext.fillStyle = color
  hiContext.textBaseline = 'alphabetic'
  hiContext.textAlign = 'left'
  hiContext.fillText(text, hiPadding + textLeft + 1, hiPadding + capAscent)

  // --- Step 2: downscale to target resolution with high-quality smoothing ---
  const width = Math.max(1, Math.round(hiWidth / SUPERSAMPLE_SCALE))
  const height = Math.max(1, Math.round(hiHeight / SUPERSAMPLE_SCALE))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', {
    willReadFrequently: true,
  }) as CanvasWithLetterSpacing | null

  if (!context) {
    throw new Error('No se pudo inicializar el lienzo del wordmark.')
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(hiCanvas, 0, 0, width, height)

  const imageData = context.getImageData(0, 0, width, height)

  return {
    width,
    height,
    data: imageData.data,
  }
}
