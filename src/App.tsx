import { useCallback, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { VehicleFormCard } from '@/components/vehicle-form'
import { FluidResultCard } from '@/components/fluid-card'
import { EmptyState, FluidCardSkeleton } from '@/components/states'
import { fetchFluidResults, DeviceDisconnectedError } from '@/lib/api'
import { mapAllResults } from '@/lib/results-mapper'
import type { FluidCardModel } from '@/lib/results-mapper'
import { isFormValid } from '@/lib/form-validation'
import { canGenerateReport, generateReport } from '@/lib/pdf-report'
import type { FormErrors, FluidResultsResponse, VehicleForm } from '@/types/fluid'

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
  const [fetchState, setFetchState] = useState<FetchState>({ kind: 'idle' })

  const results: FluidCardModel[] | null =
    fetchState.kind === 'success' ? mapAllResults(fetchState.data) : null

  const handleFetch = useCallback(async () => {
    setFetchState({ kind: 'loading' })
    try {
      const data = await fetchFluidResults()
      setFetchState({ kind: 'success', data })
      toast.success('Diagnostic data loaded.', {
        description: 'Fluid readings received from device.',
      })
    } catch (err) {
      setFetchState({ kind: 'error' })
      const message =
        err instanceof DeviceDisconnectedError
          ? err.message
          : 'Device Disconnected. Please check connection.'
      toast.error(message)
    }
  }, [])

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

  const isPrintEnabled = canGenerateReport(form, results)
  const isLoading = fetchState.kind === 'loading'

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
      <AppHeader fetchState={fetchState} />
      <main className="relative z-10 mx-auto max-w-2xl space-y-4 p-4 pb-36">
        <VehicleFormCard
          value={form}
          onChange={setForm}
          onValidationChange={setFormErrors}
        />
        <FetchButton onClick={handleFetch} isLoading={isLoading} />
        <StateArea fetchState={fetchState} results={results} />
      </main>
      <PrintBar isPrintEnabled={isPrintEnabled} onPrint={handlePrint} />
    </div>
  )
}

function AppHeader({ fetchState }: { fetchState: FetchState }) {
  const status =
    fetchState.kind === 'success'
      ? { dot: 'bg-emerald-400 glow-green', label: 'Online' }
      : fetchState.kind === 'loading'
        ? { dot: 'bg-cyan-400 glow-cyan animate-pulse', label: 'Syncing' }
        : fetchState.kind === 'error'
          ? { dot: 'bg-rose-400 glow-red', label: 'Offline' }
          : { dot: 'bg-slate-500', label: 'Standby' }

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
        <div className="flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
          <span className="text-[10px] uppercase tracking-widest text-white/50">
            {status.label}
          </span>
        </div>
      </div>
    </header>
  )
}

function FetchButton({ onClick, isLoading }: { onClick: () => void; isLoading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
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
}: {
  isPrintEnabled: boolean
  onPrint: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-[#050816]/80 p-4 backdrop-blur-2xl">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={onPrint}
          disabled={!isPrintEnabled}
          data-testid="btn-print"
          className="btn-activation flex h-14 w-full items-center justify-center gap-3 rounded-xl text-sm font-semibold uppercase tracking-wider"
        >
          <span className="text-base" aria-hidden="true">🖨️</span>
          <span>{isPrintEnabled ? 'Activate Report' : 'Report Standby'}</span>
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
