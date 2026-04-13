import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { lumaFromRgb } from './color'
import type { ClientEnv } from './env'
import type { MosaicAsset } from '../types/mosaic'

type RawAssetRow = Record<string, unknown>

function asFiniteNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

export function adaptAssetRow(row: RawAssetRow): MosaicAsset | null {
  const photoId = asString(row.photo_id)
  const thumbUrl = asString(row.thumb_url)
  const processedAt = asString(row.processed_at)
  const createdAt = asString(row.created_at)
  const status = asString(row.status)

  if (!photoId || !thumbUrl || !processedAt || !createdAt || !status) {
    return null
  }

  const avgRgb = {
    r: Math.round(asFiniteNumber(row.avg_r)),
    g: Math.round(asFiniteNumber(row.avg_g)),
    b: Math.round(asFiniteNumber(row.avg_b)),
  }

  return {
    photoId,
    thumbUrl,
    avgRgb,
    luma: asFiniteNumber(row.luma, lumaFromRgb(avgRgb)),
    aspectRatio: asFiniteNumber(row.aspect_ratio, 1),
    processedAt,
    createdAt,
    status:
      status === 'ready' || status === 'processing' || status === 'failed'
        ? status
        : 'ready',
    sourceImageUrl: asString(row.source_image_url),
  }
}

export function createMosaicSupabaseClient(env: ClientEnv) {
  if (!env.isConfigured || !env.supabaseUrl || !env.supabaseAnonKey) {
    return null
  }

  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 8,
      },
    },
  })
}

export async function fetchReadyAssets(
  client: SupabaseClient,
  env: ClientEnv,
) {
  const { data, error } = await client
    .from(env.assetTable)
    .select(
      'photo_id, thumb_url, avg_r, avg_g, avg_b, luma, aspect_ratio, processed_at, created_at, status, source_image_url',
    )
    .eq('status', 'ready')
    .order('created_at', { ascending: true })
    .limit(env.fetchLimit)

  if (error) {
    throw error
  }

  return (data ?? [])
    .map((row) => adaptAssetRow(row as RawAssetRow))
    .filter((asset): asset is MosaicAsset => asset !== null)
}
