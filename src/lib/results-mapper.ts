import type {
  BrakeOilReading,
  CoolantReading,
  EngineOilReading,
  FluidCardModel,
  FluidResultsResponse,
  FluidStatus,
} from '@/types/fluid'

// Re-exported so consumers can keep importing from the mapper module.
export type { FluidCardModel }

// Sentinel used to detect the "entire response is null/missing" case
// from mapAllResults. We mark with a non-allowed status so the per-fluid
// mapper flags it as an error.
const MISSING_SENTINEL = '__MISSING__' as const

const BRAKE_OIL_DEFAULT: BrakeOilReading = {
  moisture: 'N/A',
  status: MISSING_SENTINEL as unknown as FluidStatus,
}

const ENGINE_OIL_DEFAULT: EngineOilReading = {
  dielectric: Number.NaN,
  water: 'NO',
  status: MISSING_SENTINEL as unknown as FluidStatus,
}

const COOLANT_DEFAULT: CoolantReading = {
  ph: Number.NaN,
  status: MISSING_SENTINEL as unknown as FluidStatus,
}

function safeStatus(raw: unknown): FluidStatus {
  if (typeof raw !== 'string') return 'ERROR'
  const upper = raw.trim().toUpperCase()
  const allowed: FluidStatus[] = [
    'GOOD',
    'NORMAL',
    'WARNING',
    'BAD',
    'CRITICAL',
    'ERROR',
    'UNKNOWN',
  ]
  return (allowed as string[]).includes(upper) ? (upper as FluidStatus) : 'UNKNOWN'
}

function isMissingSentinel(raw: unknown): boolean {
  return typeof raw === 'string' && raw === MISSING_SENTINEL
}

export function mapBrakeOil(raw: Partial<BrakeOilReading> | null | undefined): FluidCardModel {
  const data = raw ?? {}
  const hasError =
    !raw ||
    typeof data.moisture !== 'string' ||
    typeof data.status !== 'string' ||
    isMissingSentinel(data.status)

  return {
    kind: 'brake_oil',
    title: 'Brake Oil',
    icon: '🛢️',
    primaryMetric: hasError ? 'N/A' : `${data.moisture} moisture`,
    secondaryMetrics: [],
    status: hasError ? 'ERROR' : safeStatus(data.status),
    hasError,
  }
}

export function mapEngineOil(raw: Partial<EngineOilReading> | null | undefined): FluidCardModel {
  const data = raw ?? {}
  const hasError =
    !raw ||
    typeof data.dielectric !== 'number' ||
    typeof data.water !== 'string' ||
    typeof data.status !== 'string' ||
    isMissingSentinel(data.status)

  return {
    kind: 'engine_oil',
    title: 'Engine Oil',
    icon: '⚙️',
    primaryMetric: hasError
      ? 'N/A'
      : `Dielectric ${Number(data.dielectric).toFixed(2)}`,
    secondaryMetrics: hasError ? [] : [`Water: ${data.water}`],
    status: hasError ? 'ERROR' : safeStatus(data.status),
    hasError,
  }
}

export function mapCoolant(raw: Partial<CoolantReading> | null | undefined): FluidCardModel {
  const data = raw ?? {}
  const hasError =
    !raw ||
    typeof data.ph !== 'number' ||
    typeof data.status !== 'string' ||
    isMissingSentinel(data.status)

  return {
    kind: 'coolant',
    title: 'Coolant',
    icon: '❄️',
    primaryMetric: hasError ? 'N/A' : `pH ${Number(data.ph).toFixed(1)}`,
    secondaryMetrics: [],
    status: hasError ? 'ERROR' : safeStatus(data.status),
    hasError,
  }
}

export function mapAllResults(
  raw: Partial<FluidResultsResponse> | null | undefined,
): FluidCardModel[] {
  return [
    mapBrakeOil(raw?.brake_oil ?? BRAKE_OIL_DEFAULT),
    mapEngineOil(raw?.engine_oil ?? ENGINE_OIL_DEFAULT),
    mapCoolant(raw?.coolant ?? COOLANT_DEFAULT),
  ]
}
