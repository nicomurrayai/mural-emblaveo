import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { lumaFromRgb } from './color'
import type { ClientEnv } from './env'
import type { MosaicAsset } from '../types/mosaic'

type RawAssetRow = Record<string, unknown>

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

// Neutral default color used when the table has no avg_r/g/b columns
const DEFAULT_RGB = { r: 128, g: 128, b: 128 }

export function adaptAssetRow(row: RawAssetRow): MosaicAsset | null {
  const photoId = asString(row.id)
  const thumbUrl = asString(row.image_url)
  const createdAt = asString(row.created_at)

  if (!photoId || !thumbUrl || !createdAt) {
    return null
  }

  return {
    photoId,
    thumbUrl,
    avgRgb: DEFAULT_RGB,
    luma: lumaFromRgb(DEFAULT_RGB),
    aspectRatio: 1,
    processedAt: createdAt,
    createdAt,
    status: 'ready',
    sourceImageUrl: thumbUrl,
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
    .select('id, image_url, created_at')
    .order('created_at', { ascending: true })
    .limit(env.fetchLimit)

  if (error) {
    throw error
  }

  return (data ?? [])
    .map((row) => adaptAssetRow(row as RawAssetRow))
    .filter((asset): asset is MosaicAsset => asset !== null)
}
