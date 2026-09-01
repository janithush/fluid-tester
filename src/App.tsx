import { useCallback, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { VehicleFormCard } from '@/components/vehicle-form'
import { FluidResultCard } from '@/components/fluid-card'
import { EmptyState, FluidCardSkeleton } from '@/components/states'
import { ConnectionIndicator } from '@/components/connection-indicator'
import { useFluidStream } from '@/hooks/useFluidStream'
import type { StreamStatus } from '@/hooks/useFluidStream'
import { mapAllResults } from '@/lib/results-mapper'
import type { FluidCardModel } from '@/lib/results-mapper'
import { isFormValid } from '@/lib/form-validation'
import { canGenerateReport, generateReport } from '@/lib/pdf-report'
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

  const handleFetch = useCallback(() => {
    if (stream.isStreaming) {
      // Already streaming — treat the button as a no-op so the operator
      // can see the live data without interruption.
      return
    }
    stream.start()
  }, [stream])

  const handleStop = useCallback(() => {
    stream.stop()
  }, [stream])

  const handlePrint = useCallback(() => {
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
    try {
      generateReport({ form, results })
      toast.success('Report downloaded.')
    } catch {
      toast.error('Failed to generate report. Please try again.')
    }
  }, [form, results])

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
      />
      <main className="relative z-10 mx-auto max-w-2xl space-y-4 p-4 pb-36">
        <VehicleFormCard
          value={form}
          onChange={setForm}
          onValidationChange={setFormErrors}
        />
        <FetchControls
          onFetch={handleFetch}
          onStop={handleStop}
          isLoading={isLoading}
          showStop={showStopButton}
        />
        <StateArea fetchState={fetchState} results={results} />
      </main>
      <PrintBar
        isPrintEnabled={isPrintEnabled}
        onPrint={handlePrint}
        frozen={stream.frozen}
      />
    </div>
  )
}

interface AppHeaderProps {
  streamStatus: StreamStatus
  isStreaming: boolean
  hasData: boolean
}

function AppHeader({ streamStatus, isStreaming, hasData }: AppHeaderProps) {
  const headerLabel =
    streamStatus === 'streaming'
      ? hasData
        ? 'Signal Live'
        : 'Acquiring'
      : streamStatus === 'connecting'
        ? 'Connecting'
        : streamStatus === 'error'
          ? 'Signal Lost'
          : 'Standby'

  const tone =
    streamStatus === 'streaming'
      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
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
                  ? 'bg-emerald-400 glow-green animate-pulse'
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
}: {
  onFetch: () => void
  onStop: () => void
  isLoading: boolean
  showStop: boolean
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
          Fetch Latest Reading
        </>
      )}
    </button>
  )
}

function StateArea({
  fetchState,
  results,
}: {
  fetchState: FetchState
  results: FluidCardModel[] | null
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
          <FluidResultCard key={r.kind} model={r} />
        ))}
      </div>
    )
  }
  return null
}

function PrintBar({
  isPrintEnabled,
  onPrint,
  frozen,
}: {
  isPrintEnabled: boolean
  onPrint: () => void
  frozen: boolean
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-[#050816]/80 p-4 backdrop-blur-2xl">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={onPrint}
          disabled={!isPrintEnabled}
          data-testid="btn-print"
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
      </div>
    </div>
  )
}
