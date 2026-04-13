import type { ConnectionState } from '../types/mosaic'

type DebugPanelProps = {
  activeCellCount: number
  connectionState: ConnectionState
  errorMessage: string | null
  filledCellCount: number
  fps: number
  isDemo: boolean
  lastUpdate: string | null
  readyAssetCount: number
}

function formatDate(value: string | null) {
  if (!value) {
    return 'sin datos'
  }

  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

export function DebugPanel({
  activeCellCount,
  connectionState,
  errorMessage,
  filledCellCount,
  fps,
  isDemo,
  lastUpdate,
  readyAssetCount,
}: DebugPanelProps) {
  return (
    <aside className="debug-panel" aria-label="Panel de debug">
      <h2 className="debug-panel__title">Debug overlay</h2>

      <div className="debug-panel__grid">
        <div className="debug-panel__item">
          <span>Modo</span>
          <strong>{isDemo ? 'demo' : 'produccion'}</strong>
        </div>

        <div className="debug-panel__item">
          <span>Conexion</span>
          <strong>{connectionState}</strong>
        </div>

        <div className="debug-panel__item">
          <span>Assets ready</span>
          <strong>{readyAssetCount}</strong>
        </div>

        <div className="debug-panel__item">
          <span>Celdas llenas</span>
          <strong>
            {filledCellCount} / {activeCellCount}
          </strong>
        </div>

        <div className="debug-panel__item">
          <span>FPS</span>
          <strong>{fps.toFixed(1)}</strong>
        </div>

        <div className="debug-panel__item">
          <span>Ultimo update</span>
          <strong>{formatDate(lastUpdate)}</strong>
        </div>
      </div>

      {errorMessage ? (
        <p className="debug-panel__error">{errorMessage}</p>
      ) : null}
    </aside>
  )
}
