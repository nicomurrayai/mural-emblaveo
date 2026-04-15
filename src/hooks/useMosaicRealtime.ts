import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import { createDemoAssets } from '../lib/demoAssets'
import { getClientEnv } from '../lib/env'
import { mergeMosaicAssets } from '../lib/mosaic'
import {
  adaptAssetRow,
  createMosaicSupabaseClient,
  fetchReadyAssets,
} from '../lib/supabase'
import type { ConnectionState, MosaicAsset } from '../types/mosaic'

type UseMosaicRealtimeResult = {
  assets: MosaicAsset[]
  connectionState: ConnectionState
  errorMessage: string | null
  isDemo: boolean
  lastUpdate: string | null
}

export function useMosaicRealtime(): UseMosaicRealtimeResult {
  const config = useMemo(() => getClientEnv(), [])
  const [assets, setAssets] = useState<MosaicAsset[]>([])
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    config.isConfigured ? 'connecting' : 'demo',
  )
  const [lastUpdate, setLastUpdate] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const mergeIncoming = useEffectEvent((incoming: MosaicAsset[]) => {
    if (incoming.length === 0) {
      return
    }

    startTransition(() => {
      setAssets((current) => mergeMosaicAssets(current, incoming))
      setLastUpdate(new Date().toISOString())
    })
  })

  useEffect(() => {
    if (!config.isConfigured) {
      const demoAssets = createDemoAssets()
      let cursor = 0

      const pushNext = () => {
        const batchSize = cursor < 18 ? 6 : 3
        const nextBatch = demoAssets.slice(cursor, cursor + batchSize)

        if (nextBatch.length === 0) {
          return
        }

        cursor += nextBatch.length
        mergeIncoming(nextBatch)
      }

      pushNext()
      const intervalHandle = window.setInterval(() => {
        pushNext()

        if (cursor >= demoAssets.length) {
          window.clearInterval(intervalHandle)
        }
      }, 1200)

      return () => {
        window.clearInterval(intervalHandle)
      }
    }

    const client = createMosaicSupabaseClient(config)

    if (!client) {
      return
    }

    let disposed = false

    const refreshAssets = async (nextState: ConnectionState) => {
      try {
        const readyAssets = await fetchReadyAssets(client, config)

        if (disposed) {
          return
        }

        if (nextState !== 'subscribed') {
          setConnectionState(nextState)
        }

        setErrorMessage(null)
        mergeIncoming(readyAssets)
      } catch (error: unknown) {
        if (disposed) {
          return
        }

        setConnectionState('error')
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'No se pudieron cargar los assets procesados.',
        )
      }
    }

    void refreshAssets('polling')

    const channel = client
      .channel(`mosaic-assets-${config.assetTable}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: config.assetTable,
        },
        (payload) => {
          const asset = adaptAssetRow(payload.new as Record<string, unknown>)

          if (!asset) {
            return
          }

          setConnectionState('subscribed')
          setErrorMessage(null)
          mergeIncoming([asset])
        },
      )
      .subscribe((status) => {
        if (disposed) {
          return
        }

        if (status === 'SUBSCRIBED') {
          setConnectionState('subscribed')
          void refreshAssets('subscribed')
          return
        }

        if (
          status === 'CHANNEL_ERROR' ||
          status === 'CLOSED' ||
          status === 'TIMED_OUT'
        ) {
          setConnectionState('polling')
        }
      })

    const intervalHandle = window.setInterval(() => {
      void refreshAssets('polling')
    }, config.pollIntervalMs)

    return () => {
      disposed = true
      window.clearInterval(intervalHandle)
      client.removeChannel(channel).catch(() => undefined)
    }
  }, [config])

  return {
    assets,
    connectionState,
    errorMessage,
    isDemo: !config.isConfigured,
    lastUpdate,
  }
}
