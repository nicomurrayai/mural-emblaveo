import { config as loadEnv } from 'dotenv'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

loadEnv()

type SourcePhoto = {
  id: string
  imageUrl: string
  createdAt: string
}

type WorkerConfig = {
  supabaseUrl: string
  serviceRoleKey: string
  sourceTable: string
  sourceIdColumn: string
  sourceImageUrlColumn: string
  sourceCreatedAtColumn: string
  assetTable: string
  thumbBucket: string
  thumbPathPrefix: string
  thumbSize: number
  batchSize: number
  sourceScanLimit: number
  pollIntervalMs: number
  runOnce: boolean
}

function required(name: string) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}.`)
  }

  return value
}

function integer(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function getConfig(): WorkerConfig {
  return {
    supabaseUrl: process.env.MOSAIC_SUPABASE_URL ?? required('VITE_SUPABASE_URL'),
    serviceRoleKey: required('MOSAIC_SUPABASE_SERVICE_ROLE_KEY'),
    sourceTable: process.env.MOSAIC_SOURCE_TABLE ?? 'event_photos',
    sourceIdColumn: process.env.MOSAIC_SOURCE_ID_COLUMN ?? 'id',
    sourceImageUrlColumn:
      process.env.MOSAIC_SOURCE_IMAGE_URL_COLUMN ?? 'image_url',
    sourceCreatedAtColumn:
      process.env.MOSAIC_SOURCE_CREATED_AT_COLUMN ?? 'created_at',
    assetTable: process.env.MOSAIC_ASSET_TABLE ?? 'mosaic_assets',
    thumbBucket: process.env.MOSAIC_THUMB_BUCKET ?? 'mosaic-thumbs',
    thumbPathPrefix: process.env.MOSAIC_THUMB_PATH_PREFIX ?? 'event',
    thumbSize: integer('MOSAIC_THUMB_SIZE', 256),
    batchSize: integer('MOSAIC_BATCH_SIZE', 24),
    sourceScanLimit: integer('MOSAIC_SOURCE_SCAN_LIMIT', 5000),
    pollIntervalMs: integer('MOSAIC_POLL_INTERVAL_MS', 5000),
    runOnce: process.argv.includes('--once'),
  }
}

const workerConfig = getConfig()
const supabase = createClient(
  workerConfig.supabaseUrl,
  workerConfig.serviceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeLuma(red: number, green: number, blue: number) {
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

async function fetchSourcePhotos() {
  const selectColumns = [
    workerConfig.sourceIdColumn,
    workerConfig.sourceImageUrlColumn,
    workerConfig.sourceCreatedAtColumn,
  ].join(', ')

  const { data, error } = await supabase
    .from(workerConfig.sourceTable)
    .select(selectColumns)
    .order(workerConfig.sourceCreatedAtColumn, { ascending: true })
    .limit(workerConfig.sourceScanLimit)

  if (error) {
    throw error
  }

  const rows = ((data ?? []) as unknown[]).map((row) => row)

  return rows
    .map((row) => {
      const sourceRow = row as Record<string, unknown>
      const rawId = sourceRow[workerConfig.sourceIdColumn]
      const rawUrl = sourceRow[workerConfig.sourceImageUrlColumn]
      const rawCreatedAt = sourceRow[workerConfig.sourceCreatedAtColumn]

      if (
        (typeof rawId !== 'string' && typeof rawId !== 'number') ||
        typeof rawUrl !== 'string' ||
        typeof rawCreatedAt !== 'string'
      ) {
        return null
      }

      return {
        id: String(rawId),
        imageUrl: rawUrl,
        createdAt: rawCreatedAt,
      } satisfies SourcePhoto
    })
    .filter((photo): photo is SourcePhoto => photo !== null)
}

async function fetchExistingAssets(photoIds: string[]) {
  if (photoIds.length === 0) {
    return new Map<string, string>()
  }

  const { data, error } = await supabase
    .from(workerConfig.assetTable)
    .select('photo_id, status')
    .in('photo_id', photoIds)

  if (error) {
    throw error
  }

  return new Map(
    (data ?? []).map((row) => [String(row.photo_id), String(row.status)]),
  )
}

async function processPhoto(photo: SourcePhoto) {
  const response = await fetch(photo.imageUrl)

  if (!response.ok) {
    throw new Error(`No se pudo descargar la imagen ${photo.id}.`)
  }

  const sourceBuffer = Buffer.from(await response.arrayBuffer())
  const image = sharp(sourceBuffer).rotate()
  const metadata = await image.metadata()
  const thumbBuffer = await image
    .resize(workerConfig.thumbSize, workerConfig.thumbSize, {
      fit: 'cover',
      position: 'attention',
    })
    .jpeg({
      quality: 82,
      mozjpeg: true,
    })
    .toBuffer()

  const stats = await sharp(thumbBuffer).stats()
  const red = Math.round(stats.channels[0]?.mean ?? 0)
  const green = Math.round(stats.channels[1]?.mean ?? 0)
  const blue = Math.round(stats.channels[2]?.mean ?? 0)
  const uploadPath = `${workerConfig.thumbPathPrefix}/${photo.id}.jpg`

  const { error: uploadError } = await supabase.storage
    .from(workerConfig.thumbBucket)
    .upload(uploadPath, thumbBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    })

  if (uploadError) {
    throw uploadError
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(workerConfig.thumbBucket).getPublicUrl(uploadPath)

  const aspectRatio =
    metadata.width && metadata.height ? metadata.width / metadata.height : 1

  const { error: upsertError } = await supabase
    .from(workerConfig.assetTable)
    .upsert(
      {
        photo_id: photo.id,
        source_image_url: photo.imageUrl,
        thumb_url: publicUrl,
        avg_r: red,
        avg_g: green,
        avg_b: blue,
        luma: Number(computeLuma(red, green, blue).toFixed(4)),
        aspect_ratio: Number(aspectRatio.toFixed(4)),
        created_at: photo.createdAt,
        processed_at: new Date().toISOString(),
        status: 'ready',
        error_message: null,
      },
      { onConflict: 'photo_id' },
    )

  if (upsertError) {
    throw upsertError
  }

  console.log(`ready -> ${photo.id}`)
}

async function markFailed(photo: SourcePhoto, reason: string) {
  const { error } = await supabase
    .from(workerConfig.assetTable)
    .upsert(
      {
        photo_id: photo.id,
        source_image_url: photo.imageUrl,
        thumb_url: '',
        avg_r: 0,
        avg_g: 0,
        avg_b: 0,
        luma: 0,
        aspect_ratio: 1,
        created_at: photo.createdAt,
        processed_at: new Date().toISOString(),
        status: 'failed',
        error_message: reason.slice(0, 280),
      },
      { onConflict: 'photo_id' },
    )

  if (error) {
    console.error(`No se pudo registrar el fallo de ${photo.id}:`, error.message)
  }
}

async function processCycle() {
  const sourcePhotos = await fetchSourcePhotos()
  const statusByPhotoId = await fetchExistingAssets(sourcePhotos.map((photo) => photo.id))
  const queue = sourcePhotos
    .filter((photo) => {
      const status = statusByPhotoId.get(photo.id)
      return status !== 'ready'
    })
    .slice(0, workerConfig.batchSize)

  if (queue.length === 0) {
    console.log('No hay fotos pendientes para procesar.')
    return
  }

  console.log(`Procesando ${queue.length} fotos...`)

  for (const photo of queue) {
    try {
      await processPhoto(photo)
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Error desconocido al procesar.'
      console.error(`failed -> ${photo.id}: ${message}`)
      await markFailed(photo, message)
    }
  }
}

async function main() {
  await processCycle()

  while (!workerConfig.runOnce) {
    await sleep(workerConfig.pollIntervalMs)
    await processCycle()
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Worker finalizado con error.',
  )
  process.exitCode = 1
})
