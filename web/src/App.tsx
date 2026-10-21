import { useCallback, useEffect, useRef, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { VehicleFormCard } from '@/components/vehicle-form'
import { FluidResultCard } from '@/components/fluid-card'
import { EmptyState, FluidCardSkeleton } from '@/components/states'
import { ConnectionIndicator } from '@/components/connection-indicator'
import { ProfileSelect } from '@/components/profile-select'
import { HistoryStrip } from '@/components/history-strip'
import { useFluidStream } from '@/hooks/useFluidStream'
import type { StreamStatus } from '@/hooks/useFluidStream'
import { mapAllResults } from '@/lib/results-mapper'
import type { FluidCardModel } from '@/lib/results-mapper'
import { evaluateAllResults } from '@/lib/fluid-profiles'
import type { ProfileEvaluation } from '@/lib/fluid-profiles'
import { isFormValid } from '@/lib/form-validation'
import { canGenerateReport, generateReport } from '@/lib/pdf-report'
import {
  exportSessionAsCsv,
  exportSessionAsJson,
} from '@/lib/export'
import {
  buildDiagnosticRun,
  saveRun,
} from '@/lib/history-db'
import type { FormErrors, FluidResultsResponse, VehicleForm } from '@/types/fluid'

/**
 * View state of the results area, derived from the WebSocket stream.
 */
type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; data: FluidResultsResponse }
  | { kind: 'error' }

const INITIAL_FORM: VehicleForm = {
  date: '',
  vehicleNumber: '',
  kmUsage: 0,
}

export default function App() {
  const [form, setForm] = useState<VehicleForm>(INITIAL_FORM)
  const [, setFormErrors] = useState<FormErrors>({})

  // F1: advisory threshold profiles (defaults = workshop majority).
  const [brakeProfileId, setBrakeProfileId] = useState<string | null>('dot-4')
  const [engineProfileId, setEngineProfileId] = useState<string | null>('semi-10w40')

  const stream = useFluidStream()

  // Derive the UI's FetchState from the hook. The hook's "streaming"
  // status means the socket is open; we only flip to "success" once a
  // frame has been seen so we don't show the results area empty.
  let fetchState: FetchState
  if (stream.error && stream.status === 'error') {
    fetchState = { kind: 'error' }
  } else if (stream.data) {
    fetchState = { kind: 'success', data: stream.data }
  } else if (stream.status === 'streaming' || stream.status === 'connecting') {
    fetchState = { kind: 'loading' }
  } else {
    fetchState = { kind: 'idle' }
  }

  const results: FluidCardModel[] | null =
    fetchState.kind === 'success' ? mapAllResults(fetchState.data) : null

  // F1: advisory re-grades against the selected fluid spec sheets.
  const profileEvaluations = evaluateAllResults(results ?? [], {
    brakeProfileId,
    engineProfileId,
  })

  // F4: persist each completed measurement session the moment the stream
  // is stopped, exactly once per frozen dataset. Failures (unsupported
  // environment, quota) degrade to silence - history is never load-bearing.
  const lastSavedDataRef = useRef<FluidResultsResponse | null>(null)
  // Bumped after every successful save; <HistoryStrip /> re-queries on it
  // so a fresh run appears in the trend the moment it lands in the store.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)
  useEffect(() => {
    if (!stream.frozen || stream.status !== 'idle') return
    const data = stream.data
    if (!data || lastSavedDataRef.current === data) return
    lastSavedDataRef.current = data
    const run = buildDiagnosticRun(form, data, mapAllResults(data), {
      brakeProfileId,
      engineProfileId,
    })
    saveRun(run)
      .then(() => {
        setHistoryRefreshKey((k) => k + 1)
        toast.success('Session saved to vehicle history')
      })
      .catch(() => {
        // No IndexedDB (tests / private mode): silent no-op by design.
      })
  }, [stream.frozen, stream.status, stream.data, form, brakeProfileId, engineProfileId])

  // F5: exports share the report bar's enabled state (frozen + data).
  const handleExportCsv = useCallback(() => {
    if (results) exportSessionAsCsv({ form, results })
  }, [form, results])

  const handleExportJson = useCallback(() => {
    if (results) exportSessionAsJson({ form, results })
  }, [form, results])

  const handleFetch = useCallback(() => {
    if (stream.isStreaming || stream.status === 'connecting') {
      // Already live or dialing - treat the button as a no-op so the
      // operator cannot double-dial the device.
      return
    }
    stream.start()
  }, [stream])

  // Bound directly to stream.stop() (stable useCallback identity).
  const handleStop = stream.stop

  const [isGenerating, setIsGenerating] = useState(false)

  const handlePrint = useCallback(() => {
    // Guard against double-clicks while the pdf chunk is rendering.
    if (isGenerating) return
    if (!results) {
      toast.error('No test results available. Please fetch data first.')
      return
    }
    if (!isFormValid(form)) {
      toast.error('Please fill all required fields')
      return
    }
    if (!canGenerateReport(form, results)) {
      toast.error('Cannot generate report. Please check form and results.')
      return
    }
    setIsGenerating(true)
    try {
      generateReport({ form, results })
      toast.success('Report downloaded.')
    } catch {
      toast.error('Failed to generate report. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }, [form, results, isGenerating])

  // Generate Report is enabled only when we have a frozen snapshot
  // (the user has explicitly stopped the stream AND there's data).
  const isPrintEnabled = stream.frozen && canGenerateReport(form, results)
  const isLoading = fetchState.kind === 'loading'
  const showStopButton = stream.isStreaming || stream.status === 'connecting'

  return (
    <div className="relative min-h-full">
      <Toaster
        richColors
        position="top-center"
        toastOptions={{
          style: {
            background: 'rgba(10, 15, 36, 0.95)',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            color: '#fff',
            backdropFilter: 'blur(20px)',
          },
        }}
      />
      <AppHeader
        streamStatus={stream.status}
        isStreaming={stream.isStreaming}
        hasData={stream.data !== null}
        isStale={stream.isStale}
      />
      <main className="relative z-10 mx-auto max-w-2xl space-y-4 p-4 pb-36">
        <VehicleFormCard
          value={form}
          onChange={setForm}
          onValidationChange={setFormErrors}
        />
        <ProfileSelect
          brakeProfileId={brakeProfileId}
          engineProfileId={engineProfileId}
          onChange={(next) => {
            setBrakeProfileId(next.brakeProfileId)
            setEngineProfileId(next.engineProfileId)
          }}
        />
        {/* F4: historical context appears as soon as the plate resolves;
            remounted via `key` whenever a new run is saved. */}
        <HistoryStrip
          key={historyRefreshKey}
          refreshKey={historyRefreshKey}
          vehicleNumber={form.vehicleNumber}
        />
        <FetchControls
          onFetch={handleFetch}
          onStop={handleStop}
          isLoading={isLoading}
          showStop={showStopButton}
          frozen={stream.frozen}
        />
        <StateArea
          fetchState={fetchState}
          results={results}
          profileEvaluations={profileEvaluations}
        />
      </main>
      <PrintBar
        isPrintEnabled={isPrintEnabled}
        onPrint={handlePrint}
        onExportCsv={handleExportCsv}
        onExportJson={handleExportJson}
        isExportEnabled={stream.frozen && results !== null}
        frozen={stream.frozen}
      />
    </div>
  )
}

interface AppHeaderProps {
  streamStatus: StreamStatus
  isStreaming: boolean
  hasData: boolean
  isStale: boolean
}

function AppHeader({ streamStatus, isStreaming, hasData, isStale }: AppHeaderProps) {
  // 'idle' distinguishes a fresh boot ("Standby") from a user-initiated
  // stop that left a frozen session on screen ("Stopped").
  const headerLabel =
    streamStatus === 'streaming'
      ? isStale
        ? 'Signal Stale'
        : hasData
          ? 'Signal Live'
          : 'Acquiring'
      : streamStatus === 'connecting'
        ? 'Connecting'
        : streamStatus === 'error'
          ? 'Signal Lost'
          : streamStatus === 'idle'
            ? hasData
              ? 'Stopped'
              : 'Standby'
            : 'Standby'

  // R3: staleness is amber (visible warning), not green (frozen lie).
  const tone =
    streamStatus === 'streaming'
      ? isStale
        ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
        : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
      : streamStatus === 'connecting'
        ? 'border-amber-400/30 bg-amber-500/10 text-amber-300'
        : streamStatus === 'error'
          ? 'border-rose-400/30 bg-rose-500/10 text-rose-300'
          : 'border-white/10 bg-white/5 text-white/50'

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-[#050816]/60 px-4 py-3 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-2xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-lg bg-cyan-500/40 blur-md" aria-hidden="true" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-400/40 bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-xl glow-cyan" aria-hidden="true">
              🧪
            </div>
          </div>
          <div>
            <h1 className="bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-lg font-bold leading-tight text-transparent">
              FlowMetrics
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-white/40">
              Diagnostic Terminal
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ConnectionIndicator status={streamStatus} isStreaming={isStreaming} />
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${tone}`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                streamStatus === 'streaming'
                  ? isStale
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-emerald-400 glow-green animate-pulse'
                  : streamStatus === 'error'
                    ? 'bg-rose-400'
                    : streamStatus === 'connecting'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-white/40'
              }`}
              aria-hidden="true"
            />
            {headerLabel}
          </span>
        </div>
      </div>
    </header>
  )
}

function FetchControls({
  onFetch,
  onStop,
  isLoading,
  showStop,
  frozen,
}: {
  onFetch: () => void
  onStop: () => void
  isLoading: boolean
  showStop: boolean
  frozen: boolean
}) {
  if (showStop) {
    return (
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <button
          type="button"
          disabled
          data-testid="btn-fetch"
          className="btn-neon flex h-14 items-center justify-center gap-2 rounded-xl text-sm font-semibold uppercase tracking-wider"
        >
          {isLoading ? (
            <>
              <span
                className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white"
                aria-hidden="true"
              />
              <span>Streaming…</span>
            </>
          ) : (
            <>
              <span
                className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse"
                style={{ boxShadow: '0 0 10px rgba(52,211,153,0.8)' }}
                aria-hidden="true"
              />
              <span>Live Reading</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onStop}
          data-testid="btn-stop"
          className="flex h-14 items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 text-sm font-semibold uppercase tracking-wider text-rose-300 transition hover:bg-rose-500/20"
        >
          <span aria-hidden="true">■</span>
          <span>Stop</span>
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onFetch}
      disabled={isLoading}
      data-testid="btn-fetch"
      className={`btn-neon flex h-14 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold uppercase tracking-wider shadow-lg ${
        isLoading ? '' : 'animate-pulse-glow'
      }`}
    >
      {isLoading ? (
        <>
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
          <span>Acquiring Signal</span>
          <span className="flex gap-0.5" aria-hidden="true">
            <span className="h-1 w-1 animate-bounce rounded-full bg-white [animation-delay:-0.3s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-white [animation-delay:-0.15s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-white" />
          </span>
        </>
      ) : (
        <>
          <span
            className="inline-block h-2 w-2 rounded-full bg-white"
            style={{ boxShadow: '0 0 10px rgba(255,255,255,0.8)' }}
            aria-hidden="true"
          />
          {frozen ? 'Resume Reading' : 'Fetch Latest Reading'}
        </>
      )}
    </button>
  )
}

function StateArea({
  fetchState,
  results,
  profileEvaluations,
}: {
  fetchState: FetchState
  results: FluidCardModel[] | null
  profileEvaluations: Record<FluidCardModel['kind'], ProfileEvaluation | null>
}) {
  if (fetchState.kind === 'idle') return <EmptyState />
  if (fetchState.kind === 'error') {
    return (
      <Card className="glass rounded-2xl border-rose-400/30 glow-red" data-testid="error-state">
        <CardContent className="py-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-rose-400/30 bg-rose-500/10 text-2xl" aria-hidden="true">
            ⚠️
          </div>
          <p className="text-base font-semibold text-rose-300">Signal Lost</p>
          <p className="mt-1.5 text-sm text-white/50">
            Verify the device is powered on and you are connected to its Wi-Fi network.
          </p>
        </CardContent>
      </Card>
    )
  }
  if (fetchState.kind === 'loading') {
    return (
      <div className="space-y-4" data-testid="loading-state">
        <FluidCardSkeleton />
        <FluidCardSkeleton />
        <FluidCardSkeleton />
      </div>
    )
  }
  if (fetchState.kind === 'success' && results) {
    return (
      <div className="space-y-4" data-testid="results">
        {results.map((r) => (
          <FluidResultCard
            key={r.kind}
            model={r}
            profileEvaluation={profileEvaluations[r.kind]}
          />
        ))}
      </div>
    )
  }
  return null
}

function PrintBar({
  isPrintEnabled,
  onPrint,
  onExportCsv,
  onExportJson,
  isExportEnabled,
  frozen,
}: {
  isPrintEnabled: boolean
  onPrint: () => void
  onExportCsv: () => void
  onExportJson: () => void
  isExportEnabled: boolean
  frozen: boolean
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-[#050816]/80 p-4 backdrop-blur-2xl">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={onPrint}
          // Disabled until the form is valid AND telemetry data exists;
          // active ("Generate Report") once both are satisfied.
          disabled={!isPrintEnabled}
          data-testid="btn-print"
          data-print-state={isPrintEnabled ? 'ready' : 'standby'}
          className="btn-neon flex h-14 w-full items-center justify-center gap-3 rounded-xl text-sm font-semibold uppercase tracking-wider"
        >
          <span className="text-base" aria-hidden="true">🖨️</span>
          <span>
            {isPrintEnabled
              ? 'Generate Report'
              : frozen
                ? 'Report Standby (form)'
                : 'Report Standby'}
          </span>
          <span
            className={`ml-1 inline-block h-1.5 w-1.5 rounded-full ${
              isPrintEnabled ? 'bg-emerald-400 glow-green animate-pulse' : 'bg-white/30'
            }`}
            aria-hidden="true"
          />
        </button>
        {/* F5: machine-readable session export for fleet-sheet ingest.
            Enabled whenever a completed (frozen) measurement exists. */}
        <div className="mt-2 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onExportCsv}
            disabled={!isExportEnabled}
            data-testid="btn-export-csv"
            className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-xs font-semibold uppercase tracking-wider transition ${
              isExportEnabled
                ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                : 'border-white/10 bg-white/5 text-white/30'
            }`}
          >
            <span aria-hidden="true">⬇</span>
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={onExportJson}
            disabled={!isExportEnabled}
            data-testid="btn-export-json"
            className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-xs font-semibold uppercase tracking-wider transition ${
              isExportEnabled
                ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                : 'border-white/10 bg-white/5 text-white/30'
            }`}
          >
            <span aria-hidden="true">⬇</span>
            <span>Export JSON</span>
          </button>
        </div>
      </div>
    </div>
  )
}
