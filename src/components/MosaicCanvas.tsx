import { useDeferredValue, useEffect, useEffectEvent, useRef } from 'react'
import { brighten, darken, rgbToCss } from '../lib/color'
import type { LogoGrid, MosaicPlacement, RGB } from '../types/mosaic'

const FRAME_INTERVAL_MS = 1000 / 30
const MAX_DEVICE_PIXEL_RATIO = 1.5
const REVEAL_DURATION_MS = 720

type MosaicCanvasProps = {
  grid: LogoGrid | null
  placements: MosaicPlacement[]
  onFpsChange: (fps: number) => void
}

type ImageCacheEntry =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; image: HTMLImageElement }

type Size = {
  width: number
  height: number
}

function containSize(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number,
  maxHeight: number,
): Size {
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight)

  return {
    width: sourceWidth * scale,
    height: sourceHeight * scale,
  }
}

function easeOutCubic(value: number) {
  return 1 - (1 - value) ** 3
}

function drawBackdrop(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  now: number,
) {
  context.fillStyle = '#04050f'
  context.fillRect(0, 0, width, height)

  const bloom = context.createRadialGradient(
    width * 0.5,
    height * 0.35,
    height * 0.08,
    width * 0.5,
    height * 0.35,
    height * 0.72,
  )
  bloom.addColorStop(0, 'rgba(35, 139, 98, 0.28)')
  bloom.addColorStop(0.38, 'rgba(27, 42, 92, 0.22)')
  bloom.addColorStop(1, 'rgba(4, 5, 15, 0)')
  context.fillStyle = bloom
  context.fillRect(0, 0, width, height)

  context.save()
  context.globalAlpha = 0.18
  context.translate(width * 0.15, height * -0.05)
  context.rotate(-0.18)
  context.fillStyle = 'rgba(39, 197, 135, 0.2)'
  context.fillRect(0, 0, width * 0.18, height * 1.4)
  context.restore()

  context.save()
  context.strokeStyle = 'rgba(180, 196, 255, 0.055)'
  context.lineWidth = 1

  for (let x = 0; x <= width; x += 84) {
    context.beginPath()
    context.moveTo(x + 0.5, 0)
    context.lineTo(x + 0.5, height)
    context.stroke()
  }

  for (let y = 0; y <= height; y += 84) {
    context.beginPath()
    context.moveTo(0, y + 0.5)
    context.lineTo(width, y + 0.5)
    context.stroke()
  }

  context.restore()

  const scanlineY = ((now * 0.025) % (height + 240)) - 120
  const scanline = context.createLinearGradient(0, scanlineY, 0, scanlineY + 180)
  scanline.addColorStop(0, 'rgba(255,255,255,0)')
  scanline.addColorStop(0.5, 'rgba(120, 173, 255, 0.055)')
  scanline.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = scanline
  context.fillRect(0, scanlineY, width, 180)
}

function drawLogoGlow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save()
  context.shadowBlur = 48
  context.shadowColor = 'rgba(28, 173, 112, 0.18)'
  context.strokeStyle = 'rgba(147, 167, 255, 0.08)'
  context.lineWidth = 1
  context.strokeRect(x - 6, y - 6, width + 12, height + 12)
  context.restore()
}

function drawPlaceholder(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RGB,
) {
  context.fillStyle = rgbToCss(darken(color, 0.56), 0.18)
  context.fillRect(x, y, width, height)
  context.strokeStyle = rgbToCss(brighten(color, 0.08), 0.11)
  context.lineWidth = 0.85
  context.strokeRect(x + 0.35, y + 0.35, width - 0.7, height - 0.7)
}

function drawTileFallback(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RGB,
) {
  const gradient = context.createLinearGradient(x, y, x + width, y + height)
  const darker = darken(color, 0.25)
  const lighter = brighten(color, 0.24)
  gradient.addColorStop(0, rgbToCss(lighter, 0.92))
  gradient.addColorStop(1, rgbToCss(darker, 0.92))
  context.fillStyle = gradient
  context.fillRect(x, y, width, height)
}

export function MosaicCanvas({
  grid,
  placements,
  onFpsChange,
}: MosaicCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageCacheRef = useRef<Map<string, ImageCacheEntry>>(new Map())
  const revealTimesRef = useRef<Map<string, number>>(new Map())
  const sceneRef = useRef<{
    grid: LogoGrid | null
    placements: MosaicPlacement[]
  }>({
    grid,
    placements,
  })

  const deferredPlacements = useDeferredValue(placements)

  useEffect(() => {
    sceneRef.current.grid = grid
  }, [grid])

  useEffect(() => {
    sceneRef.current.placements = deferredPlacements

    const now = performance.now()
    for (const placement of deferredPlacements) {
      if (!revealTimesRef.current.has(placement.asset.photoId)) {
        revealTimesRef.current.set(placement.asset.photoId, now)
      }
    }
  }, [deferredPlacements])

  useEffect(() => {
    for (const placement of deferredPlacements) {
      const cached = imageCacheRef.current.get(placement.asset.thumbUrl)

      if (cached) {
        continue
      }

      imageCacheRef.current.set(placement.asset.thumbUrl, { status: 'loading' })
      const image = new Image()
      image.decoding = 'async'
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        imageCacheRef.current.set(placement.asset.thumbUrl, {
          status: 'ready',
          image,
        })
      }
      image.onerror = () => {
        imageCacheRef.current.set(placement.asset.thumbUrl, { status: 'error' })
      }
      image.src = placement.asset.thumbUrl
    }
  }, [deferredPlacements])

  const drawFrame = useEffectEvent((now: number) => {
    const canvas = canvasRef.current
    const currentGrid = sceneRef.current.grid

    if (!canvas || !currentGrid) {
      return
    }

    const devicePixelRatio = Math.min(
      window.devicePixelRatio || 1,
      MAX_DEVICE_PIXEL_RATIO,
    )
    const viewportWidth = canvas.clientWidth
    const viewportHeight = canvas.clientHeight
    const targetWidth = Math.max(1, Math.round(viewportWidth * devicePixelRatio))
    const targetHeight = Math.max(
      1,
      Math.round(viewportHeight * devicePixelRatio),
    )

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
    }

    const context = canvas.getContext('2d')

    if (!context) {
      return
    }

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.scale(devicePixelRatio, devicePixelRatio)

    drawBackdrop(context, viewportWidth, viewportHeight, now)

    const fittedLogo = containSize(
      currentGrid.width,
      currentGrid.height,
      viewportWidth * 0.9,
      viewportHeight * 0.54,
    )
    const offsetX = (viewportWidth - fittedLogo.width) / 2
    const offsetY = (viewportHeight - fittedLogo.height) / 2
    const scaleX = fittedLogo.width / currentGrid.width
    const scaleY = fittedLogo.height / currentGrid.height

    drawLogoGlow(context, offsetX, offsetY, fittedLogo.width, fittedLogo.height)

    for (const cell of currentGrid.cells) {
      drawPlaceholder(
        context,
        offsetX + cell.x * scaleX,
        offsetY + cell.y * scaleY,
        cell.width * scaleX,
        cell.height * scaleY,
        cell.targetRgb,
      )
    }

    for (const placement of sceneRef.current.placements) {
      const revealAt =
        revealTimesRef.current.get(placement.asset.photoId) ?? performance.now()
      const progress = Math.min(1, (now - revealAt) / REVEAL_DURATION_MS)
      const eased = easeOutCubic(progress)
      const baseX = offsetX + placement.cell.x * scaleX
      const baseY = offsetY + placement.cell.y * scaleY
      const baseWidth = placement.cell.width * scaleX
      const baseHeight = placement.cell.height * scaleY
      const animatedWidth = baseWidth * (0.68 + eased * 0.32)
      const animatedHeight = baseHeight * (0.68 + eased * 0.32)
      const drawX = baseX + (baseWidth - animatedWidth) / 2
      const drawY = baseY + (baseHeight - animatedHeight) / 2

      context.save()
      context.globalAlpha = 0.2 + eased * 0.8

      const cachedImage = imageCacheRef.current.get(placement.asset.thumbUrl)

      if (cachedImage?.status === 'ready') {
        context.drawImage(
          cachedImage.image,
          drawX,
          drawY,
          animatedWidth,
          animatedHeight,
        )
      } else {
        drawTileFallback(
          context,
          drawX,
          drawY,
          animatedWidth,
          animatedHeight,
          placement.asset.avgRgb,
        )
      }

      context.fillStyle = rgbToCss(placement.cell.targetRgb, 0.06)
      context.fillRect(drawX, drawY, animatedWidth, animatedHeight)
      context.strokeStyle = rgbToCss(brighten(placement.cell.targetRgb, 0.16), 0.2)
      context.lineWidth = 0.9
      context.strokeRect(
        drawX + 0.45,
        drawY + 0.45,
        animatedWidth - 0.9,
        animatedHeight - 0.9,
      )
      context.restore()
    }
  })

  useEffect(() => {
    let frameHandle = 0
    let lastPaint = 0
    let frameCounter = 0
    let fpsWindowStart = performance.now()

    const render = (now: number) => {
      frameHandle = window.requestAnimationFrame(render)

      if (now - lastPaint < FRAME_INTERVAL_MS) {
        return
      }

      lastPaint = now
      frameCounter += 1
      drawFrame(now)

      if (now - fpsWindowStart >= 1000) {
        const fps = (frameCounter * 1000) / (now - fpsWindowStart)
        onFpsChange(fps)
        frameCounter = 0
        fpsWindowStart = now
      }
    }

    frameHandle = window.requestAnimationFrame(render)

    return () => {
      window.cancelAnimationFrame(frameHandle)
    }
  }, [onFpsChange])

  return (
    <canvas
      ref={canvasRef}
      className="mosaic-screen__canvas"
      aria-label="Mural fotomosaico en tiempo real"
    />
  )
}
