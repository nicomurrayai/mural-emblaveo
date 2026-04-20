import { useDeferredValue, useEffect, useEffectEvent, useRef } from 'react'
import { brighten, darken, rgbToCss } from '../lib/color'
import type { LogoGrid, MosaicPlacement, RGB } from '../types/mosaic'

const FRAME_INTERVAL_MS = 1000 / 30
const MAX_DEVICE_PIXEL_RATIO = 1.5
const REVEAL_DURATION_MS = 2200
const PHASE_APPEAR_END = 0.16
const PHASE_HOLD_END = 0.42
const STAGGER_MS = 280
const CENTER_SIZE_RATIO = 0.48
const FILL_REVEAL_DURATION_MS = 320
const FILL_WAVE_DELAY_MS = 70
const FILL_REVEAL_WAVE_DIVISOR = 24

type MosaicCanvasProps = {
  grid: LogoGrid | null
  placements: MosaicPlacement[]
  onFpsChange: (fps: number) => void
}

type ImageCacheEntry =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; image: HTMLImageElement }

type RevealConfig = {
  revealAt: number
  durationMs: number
  mode: 'center' | 'local'
}

type Size = {
  width: number
  height: number
}

type Frame = {
  x: number
  y: number
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

function easeInOutCubic(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function easeOutBack(value: number) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (value - 1) ** 3 + c1 * (value - 1) ** 2
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t
}

function insetTileFrame(
  x: number,
  y: number,
  width: number,
  height: number,
): Frame {
  const minDimension = Math.min(width, height)

  if (minDimension <= 1.6) {
    return { x, y, width, height }
  }

  const inset = Math.min(
    Math.max(minDimension * 0.12, 0.18),
    1.8,
    minDimension * 0.24,
  )

  return {
    x: x + inset,
    y: y + inset,
    width: Math.max(0.5, width - inset * 2),
    height: Math.max(0.5, height - inset * 2),
  }
}

function compareFillRevealOrder(
  left: MosaicPlacement,
  right: MosaicPlacement,
  grid: LogoGrid | null,
) {
  const centerRow = ((grid?.rows ?? 1) - 1) / 2
  const centerColumn = ((grid?.columns ?? 1) - 1) / 2
  const leftDistance =
    (left.cell.row - centerRow) ** 2 + (left.cell.column - centerColumn) ** 2
  const rightDistance =
    (right.cell.row - centerRow) ** 2 +
    (right.cell.column - centerColumn) ** 2

  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance
  }

  if (left.cell.row !== right.cell.row) {
    return left.cell.row - right.cell.row
  }

  return left.cell.column - right.cell.column
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
  context.strokeStyle = rgbToCss(brighten(color, 0.08), 0.08)
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
  const revealConfigsRef = useRef<Map<string, RevealConfig>>(new Map())
  const firstEffectRanRef = useRef(false)
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

    const activePlacementIds = new Set(
      deferredPlacements.map((placement) => placement.placementId),
    )

    for (const placementId of revealConfigsRef.current.keys()) {
      if (!activePlacementIds.has(placementId)) {
        revealConfigsRef.current.delete(placementId)
      }
    }

    const now = performance.now()

    if (!firstEffectRanRef.current) {
      firstEffectRanRef.current = true

      for (const placement of deferredPlacements) {
        revealConfigsRef.current.set(placement.placementId, {
          revealAt: now - REVEAL_DURATION_MS,
          durationMs:
            placement.kind === 'reused'
              ? FILL_REVEAL_DURATION_MS
              : REVEAL_DURATION_MS,
          mode: placement.kind === 'reused' ? 'local' : 'center',
        })
      }

      return
    }

    const freshOriginals: MosaicPlacement[] = []
    const freshReused: MosaicPlacement[] = []

    for (const placement of deferredPlacements) {
      if (revealConfigsRef.current.has(placement.placementId)) {
        continue
      }

      if (placement.kind === 'reused') {
        freshReused.push(placement)
        continue
      }

      freshOriginals.push(placement)
    }

    freshOriginals.forEach((placement, index) => {
      revealConfigsRef.current.set(placement.placementId, {
        revealAt: now + index * STAGGER_MS,
        durationMs: REVEAL_DURATION_MS,
        mode: 'center',
      })
    })

    if (freshReused.length > 0) {
      const waveSize = Math.max(
        1,
        Math.ceil(freshReused.length / FILL_REVEAL_WAVE_DIVISOR),
      )

      freshReused
        .sort((left, right) => compareFillRevealOrder(left, right, grid))
        .forEach((placement, index) => {
          const waveIndex = Math.floor(index / waveSize)

          revealConfigsRef.current.set(placement.placementId, {
            revealAt: now + waveIndex * FILL_WAVE_DELAY_MS,
            durationMs: FILL_REVEAL_DURATION_MS,
            mode: 'local',
          })
        })
    }
  }, [deferredPlacements, grid])

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
      viewportWidth * 0.98,
      viewportHeight * 0.78,
    )
    const offsetX = (viewportWidth - fittedLogo.width) / 2
    const offsetY = (viewportHeight - fittedLogo.height) / 2
    const scaleX = fittedLogo.width / currentGrid.width
    const scaleY = fittedLogo.height / currentGrid.height

    drawLogoGlow(context, offsetX, offsetY, fittedLogo.width, fittedLogo.height)

    for (const cell of currentGrid.cells) {
      const frame = insetTileFrame(
        offsetX + cell.x * scaleX,
        offsetY + cell.y * scaleY,
        cell.width * scaleX,
        cell.height * scaleY,
      )

      drawPlaceholder(
        context,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        cell.targetRgb,
      )
    }

    const centerX = viewportWidth / 2
    const centerY = viewportHeight / 2
    const bigSize = Math.min(viewportWidth, viewportHeight) * CENTER_SIZE_RATIO

    const settledPlacements: MosaicPlacement[] = []
    const animatingPlacements: Array<{
      placement: MosaicPlacement
      progress: number
      mode: RevealConfig['mode']
    }> = []

    for (const placement of sceneRef.current.placements) {
      const revealConfig = revealConfigsRef.current.get(placement.placementId) ?? {
        revealAt: now - REVEAL_DURATION_MS,
        durationMs:
          placement.kind === 'reused'
            ? FILL_REVEAL_DURATION_MS
            : REVEAL_DURATION_MS,
        mode: placement.kind === 'reused' ? 'local' : 'center',
      }
      const elapsed = now - revealConfig.revealAt

      if (elapsed >= revealConfig.durationMs) {
        settledPlacements.push(placement)
        continue
      }

      if (elapsed < 0) {
        continue
      }

      animatingPlacements.push({
        placement,
        progress: elapsed / revealConfig.durationMs,
        mode: revealConfig.mode,
      })
    }

    const drawPlacementAt = (
      placement: MosaicPlacement,
      drawX: number,
      drawY: number,
      drawWidth: number,
      drawHeight: number,
      alpha: number,
      glowIntensity: number,
    ) => {
      context.save()
      context.globalAlpha = alpha

      if (glowIntensity > 0) {
        context.shadowBlur = 32 + glowIntensity * 32
        context.shadowColor = `rgba(140, 200, 255, ${0.35 + glowIntensity * 0.4})`
      }

      const cachedImage = imageCacheRef.current.get(placement.asset.thumbUrl)

      if (cachedImage?.status === 'ready') {
        context.drawImage(
          cachedImage.image,
          drawX,
          drawY,
          drawWidth,
          drawHeight,
        )
      } else {
        drawTileFallback(
          context,
          drawX,
          drawY,
          drawWidth,
          drawHeight,
          placement.asset.avgRgb,
        )
      }

      context.shadowBlur = 0
      context.fillStyle = rgbToCss(placement.cell.targetRgb, 0.03)
      context.fillRect(drawX, drawY, drawWidth, drawHeight)
      context.strokeStyle = rgbToCss(
        brighten(placement.cell.targetRgb, 0.16),
        0.14,
      )
      context.lineWidth = 0.9
      context.strokeRect(
        drawX + 0.45,
        drawY + 0.45,
        drawWidth - 0.9,
        drawHeight - 0.9,
      )
      context.restore()
    }

    for (const placement of settledPlacements) {
      const frame = insetTileFrame(
        offsetX + placement.cell.x * scaleX,
        offsetY + placement.cell.y * scaleY,
        placement.cell.width * scaleX,
        placement.cell.height * scaleY,
      )

      drawPlacementAt(
        placement,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        1,
        0,
      )
    }

    for (const { placement, progress, mode } of animatingPlacements) {
      const baseFrame = insetTileFrame(
        offsetX + placement.cell.x * scaleX,
        offsetY + placement.cell.y * scaleY,
        placement.cell.width * scaleX,
        placement.cell.height * scaleY,
      )
      const baseX = baseFrame.x
      const baseY = baseFrame.y
      const baseWidth = baseFrame.width
      const baseHeight = baseFrame.height

      let drawX: number
      let drawY: number
      let drawWidth: number
      let drawHeight: number
      let alpha: number
      let glowIntensity: number

      if (mode === 'local') {
        const eased = easeOutCubic(progress)
        const scale = 0.92 + eased * 0.08

        drawWidth = baseWidth * scale
        drawHeight = baseHeight * scale
        drawX = baseX + (baseWidth - drawWidth) / 2
        drawY = baseY + (baseHeight - drawHeight) / 2
        alpha = eased
        glowIntensity = progress < 0.78 ? 0.2 : 0
      } else {
        const aspectRatio = placement.asset.aspectRatio || 1
        const bigWidth = aspectRatio >= 1 ? bigSize : bigSize * aspectRatio
        const bigHeight = aspectRatio >= 1 ? bigSize / aspectRatio : bigSize

        if (progress < PHASE_APPEAR_END) {
          const localT = progress / PHASE_APPEAR_END
          const easedScale = easeOutBack(localT)
          const easedAlpha = easeOutCubic(localT)
          drawWidth = bigWidth * easedScale
          drawHeight = bigHeight * easedScale
          drawX = centerX - drawWidth / 2
          drawY = centerY - drawHeight / 2
          alpha = easedAlpha
          glowIntensity = 1
        } else if (progress < PHASE_HOLD_END) {
          drawWidth = bigWidth
          drawHeight = bigHeight
          drawX = centerX - drawWidth / 2
          drawY = centerY - drawHeight / 2
          alpha = 1
          glowIntensity = 0.7
        } else {
          const localT = (progress - PHASE_HOLD_END) / (1 - PHASE_HOLD_END)
          const eased = easeInOutCubic(localT)
          drawWidth = lerp(bigWidth, baseWidth, eased)
          drawHeight = lerp(bigHeight, baseHeight, eased)
          const currentCenterX = lerp(centerX, baseX + baseWidth / 2, eased)
          const currentCenterY = lerp(centerY, baseY + baseHeight / 2, eased)
          drawX = currentCenterX - drawWidth / 2
          drawY = currentCenterY - drawHeight / 2
          alpha = 1
          glowIntensity = lerp(0.5, 0, eased)
        }
      }

      drawPlacementAt(
        placement,
        drawX,
        drawY,
        drawWidth,
        drawHeight,
        alpha,
        glowIntensity,
      )
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
