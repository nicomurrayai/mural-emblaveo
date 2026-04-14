import { useEffect, useMemo, useState } from 'react'
import './App.css'
import logoPrimary from './assets/logo-primary.png'
import logoPfizer from './assets/logo-pfizer.png'
import { DebugPanel } from './components/DebugPanel'
import { MosaicCanvas } from './components/MosaicCanvas'
import { useMosaicRealtime } from './hooks/useMosaicRealtime'
import { buildLogoGrid } from './lib/logoGrid'
import { buildMosaicPlacements } from './lib/mosaic'
import type { LogoGrid } from './types/mosaic'

function App() {
  const [logoGrid, setLogoGrid] = useState<LogoGrid | null>(null)
  const [gridError, setGridError] = useState<string | null>(null)
  const [debugVisible, setDebugVisible] = useState(false)
  const [fps, setFps] = useState(0)
  const [autoFillEnabled, setAutoFillEnabled] = useState(false)

  const { assets, connectionState, errorMessage, isDemo, lastUpdate } =
    useMosaicRealtime()

  useEffect(() => {
    let cancelled = false

    buildLogoGrid(logoPrimary)
      .then((grid) => {
        if (cancelled) {
          return
        }

        setLogoGrid(grid)
        setGridError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }

        setGridError(
          error instanceof Error
            ? error.message
            : 'No se pudo construir la malla del logo.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyD') {
        setDebugVisible((current) => !current)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const basePlacementState = useMemo(
    () =>
      logoGrid
        ? buildMosaicPlacements(logoGrid.cells, assets)
        : { cells: [], placements: [] },
    [assets, logoGrid],
  )

  const placementState = useMemo(
    () =>
      logoGrid
        ? buildMosaicPlacements(logoGrid.cells, assets, {
            autoFillEmpty: autoFillEnabled,
          })
        : { cells: [], placements: [] },
    [assets, autoFillEnabled, logoGrid],
  )

  const activeCellCount = logoGrid?.cells.length ?? 0
  const emptyCellCount = basePlacementState.cells.filter(
    (cell) => !cell.occupiedByPhotoId,
  ).length
  const filledCellCount = placementState.placements.length
  const canToggleAutoFill =
    autoFillEnabled || (assets.length > 0 && emptyCellCount > 0)

  return (
    <main className="mural-shell">
      <div className="mural-shell__chrome" aria-hidden="true" />
      <MosaicCanvas
        grid={logoGrid}
        placements={placementState.placements}
        onFpsChange={setFps}
      />

      <header className="mural-title">
        <h1 className="mural-title__text">
          Súmate a esta nueva era en el tratamiento de infecciones multiresistentes
        </h1>
      </header>

      <footer className="mural-footer">
        <div className="mural-footer__bar">
          <img
            src={logoPfizer}
            alt="Pfizer"
            className="mural-footer__logo"
          />
        </div>
      </footer>

      <div className="mural-switch">
        <button
          type="button"
          className="mural-footer__switch"
          onClick={() => {
            setAutoFillEnabled((current) => !current)
          }}
          disabled={!canToggleAutoFill}
          role="switch"
          aria-checked={autoFillEnabled}
          aria-label="Autocompletado del mural"
        >
          <span className="mural-footer__switch-track" aria-hidden="true">
            <span className="mural-footer__switch-thumb" />
          </span>
        </button>
      </div>

      {!debugVisible && errorMessage ? (
        <aside className="mural-shell__toast" role="status">
          Realtime degradado a polling. El mural sigue vivo.
        </aside>
      ) : null}

      {logoGrid === null && !gridError ? (
        <div className="mural-shell__status" role="status">
          Calibrando la malla del logo...
        </div>
      ) : null}

      {gridError ? (
        <div className="mural-shell__status mural-shell__status--error">
          {gridError}
        </div>
      ) : null}

      {debugVisible ? (
        <DebugPanel
          activeCellCount={activeCellCount}
          connectionState={connectionState}
          errorMessage={errorMessage}
          filledCellCount={filledCellCount}
          fps={fps}
          isDemo={isDemo}
          lastUpdate={lastUpdate}
          readyAssetCount={assets.length}
        />
      ) : null}
    </main>
  )
}

export default App
