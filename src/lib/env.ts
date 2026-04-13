const DEFAULT_ASSET_TABLE = 'mosaic_assets'
const DEFAULT_FETCH_LIMIT = 5000
const DEFAULT_POLL_INTERVAL_MS = 15000

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? '', 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export type ClientEnv = {
  supabaseUrl: string | null
  supabaseAnonKey: string | null
  assetTable: string
  fetchLimit: number
  pollIntervalMs: number
  isConfigured: boolean
}

export function getClientEnv(): ClientEnv {
  const env = import.meta.env
  const supabaseUrl = env.VITE_SUPABASE_URL ?? null
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY ?? null

  return {
    supabaseUrl,
    supabaseAnonKey,
    assetTable: env.VITE_SUPABASE_ASSET_TABLE ?? DEFAULT_ASSET_TABLE,
    fetchLimit: positiveInt(env.VITE_MOSAIC_FETCH_LIMIT, DEFAULT_FETCH_LIMIT),
    pollIntervalMs: positiveInt(
      env.VITE_MOSAIC_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    isConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  }
}
