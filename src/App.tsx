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

    buildLogoGrid(logoPrimary, {
      includeWordmark: false,
    })
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

      <header className="mural-title">
        <h1 className="mural-title__text">
          SUMATE A ESTA <span className="mural-title__accent">NUEVA ERA</span>{' '}
          EN EL TRATAMIENTO DE INFECCIONES MULTIRESISTENTES<sup className='sup'>1</sup>
        </h1>
      </header>

      <div className="mural-shell__stage">
        <MosaicCanvas
          grid={logoGrid}
          placements={placementState.placements}
          onFpsChange={setFps}
        />
      </div>

      <footer className="mural-footer">
        <div className="mural-footer__bar">
          <img
            src={logoPfizer}
            alt="Pfizer"
            className="mural-footer__logo"
          />
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
        <p className="mural-footer__disclaimer">
          Referencia: 1. DaikosGL et al.Aztreonam-avibactam for serious infections by MBL-producingGram-negatives: Phase 3 trial (ASSEMBLE). JAC AntimicrobResist. 2025;7(4)
          {' '}Resumen de seguridad: Emblaveo (Aztreonam/Avibactam) es una combinación de un monobactam con un inhibidor de betalactamasas, indicado para el tratamiento de las siguientes infecciones en pacientes adultos: Infección intraabdominal complicada (IIAc), Neumonía adquirida en el hospital (NAH), incluyendo neumonía asociada a ventilación mecánica (NAV), Infección del tracto urinario complicada (ITUc), incluyendo pielonefritis e infecciones causadas por microorganismos gramnegativos aerobios en pacientes adultos con opciones terapéuticas limitadas. Forma de administración: Vía intravenosa (IV), mediante perfusión IV durante 3 horas. Las reacciones adversas más frecuentes fueron anemia (6,9%), diarrea (6,2%), y elevación de la alanina aminotransferasa (ALT) (6,2%) y del aspartato aminotransferasa (AST) (5,2%), síndrome confusional, mareos, flebitis, erupción cutánea, náuseas y vómitos. Contraindicaciones: Hipersensibilidad a los principios activos o a alguno de los excipientes. Hipersensibilidad grave a cualquier otro tipo de antibiótico betalactámico. Embarazo: Aztreonam/avibactam solo debe utilizarse durante el embarazo cuando esté claramente indicado y solo si el beneficio para la madre supera el riesgo para el niño. Se desconoce si avibactam se excreta en la leche materna. Espectro de actividad: Aztreonam tiene poca o ninguna actividad frente a la mayoría de Acinetobacter spp., microorganismos grampositivos y anaerobios. Advertencias: Este medicamento contiene aproximadamente 44,6 mg de sodio por vial. La eliminación de aztreonam y avibactam está disminuida en pacientes con insuficiencia renal. Se necesita el ajuste de dosis en pacientes con un CrCl estimada ≤50 mL/min. No se requiere un ajuste de dosis en pacientes con insuficiencia renal leve (CrCl estimado &gt;50 a ≤80 mL/min). No se requiere un ajuste de dosis en función de la edad en estos añosos. No es necesario ajustar la dosis en pacientes con insuficiencia hepática. No se ha evaluado la farmacocinética de aztreonam/avibactam en los pacientes pediátricos. Con el uso de aztreonam se han notificado casos de: diarrea asociada a Clostridioides difficile (DACD) y de colitis pseudomembranosa; prolongación del tiempo de protrombina; posibilidad de obtener un resultado positivo en el test de Coombs directo o indirecto. Interacciones medicamentosas: Aztreonam no se metaboliza por las enzimas del citocromo P450. Probenecid (un inhibidor potente del OAT) inhibe la recaptación de avibactam en un 56% a 70% in vitro y, por tanto, puede alterar la eliminación de avibactam cuando se administra de forma concomitante.
        </p>
      </footer>

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
