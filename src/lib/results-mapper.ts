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

// Default placeholders for the `mapAllResults` case where the entire
// response is missing. Using `null` and `NO_DATA` so the per-fluid
// mapper naturally surfaces the universal "no data" state.
const BRAKE_OIL_DEFAULT: BrakeOilReading = {
  moisture: null,
  status: 'NO_DATA',
}

const ENGINE_OIL_DEFAULT: EngineOilReading = {
  dielectric: null,
  capacitance: null,
  water: null,
  tbn: null,
  tan: null,
  viscosity: null,
  status: 'NO_DATA',
}

const COOLANT_DEFAULT: CoolantReading = {
  ph: null,
  status: 'NO_DATA',
}

const ALLOWED_STATUSES: ReadonlyArray<FluidStatus> = [
  'GOOD',
  'NORMAL',
  'WARNING',
  'BAD',
  'CRITICAL',
  'ERROR',
  'NO_DATA',
  'UNKNOWN',
]

function safeStatus(raw: unknown): FluidStatus {
  if (typeof raw !== 'string') return 'ERROR'
  const upper = raw.trim().toUpperCase() as FluidStatus
  return ALLOWED_STATUSES.includes(upper) ? upper : 'UNKNOWN'
}

export function mapBrakeOil(raw: Partial<BrakeOilReading> | null | undefined): FluidCardModel {
  const data = raw ?? {}
  const noData =
    !raw ||
    data.moisture === null ||
    data.moisture === undefined ||
    safeStatus(data.status) === 'NO_DATA'
  // Errors only apply when we DID get a payload but it's malformed (e.g.
  // wrong type, or status not a string). noData wins over hasError.
  const hasError = !noData && (
    (typeof data.moisture !== 'string') ||
    typeof data.status !== 'string'
  )

  const status: FluidStatus = noData
    ? 'NO_DATA'
    : hasError
      ? 'ERROR'
      : safeStatus(data.status)

  return {
    kind: 'brake_oil',
    title: 'Brake Oil',
    icon: '🛢️',
    primaryMetric: noData
      ? 'No measurement yet'
      : hasError
        ? 'N/A'
        : `${data.moisture} moisture`,
    secondaryMetrics: [],
    status,
    hasError,
    noData,
  }
}

/**
 * Formatter for engine-oil sub-metrics. The chemistry fields (TBN/TAN/Viscosity)
 * are always rendered (as "N/A" when null) per product decision: the operator
 * must always see *which* metrics the system is tracking, even before the
 * sensor ships. Capacitance is rendered the same way (N/A when not measured).
 * Water is only rendered when a dielectric reading exists (it's physically
 * meaningless without a dielectric constant).
 */
function formatEngineSubMetric(
  label: string,
  value: number | string | null | undefined,
  unit: string,
): string {
  if (value === null || value === undefined) return `${label}: N/A`
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return `${label}: N/A`
    return `${label}: ${value.toFixed(2)}${unit}`
  }
  // Any non-number (string, boolean, object) is treated as "N/A" — the
  // wire contract only allows numbers or null, so anything else is
  // effectively a parse error from the firmware.
  return `${label}: N/A`
}

export function mapEngineOil(raw: Partial<EngineOilReading> | null | undefined): FluidCardModel {
  const data = raw ?? {}
  // Backward-compat: a legacy payload that doesn't include the new fields
  // must coerce to null (not "undefined"), so the formatter can emit "N/A".
  const capacitance = (data as { capacitance?: number | null }).capacitance ?? null
  const tbn = (data as { tbn?: number | null }).tbn ?? null
  const tan = (data as { tan?: number | null }).tan ?? null
  const viscosity = (data as { viscosity?: number | null }).viscosity ?? null

  // Universal noData: ALL five numeric fields are null AND status is NO_DATA.
  // If even one numeric field is present, the card is live (partial readings
  // are honest data, not "no measurement").
  const numericFields = [data.dielectric, capacitance, tbn, tan, viscosity]
  const allNumericNull = numericFields.every(
    (v) => v === null || v === undefined,
  )
  const noData =
    !raw || (allNumericNull && safeStatus(data.status) === 'NO_DATA')

  // Errors only apply when we DID get a payload but it's malformed.
  // noData wins over hasError, and the new fields are optional (legacy
  // payloads don't have them at all).
  const hasError = !noData && (
    (typeof data.dielectric !== 'number' && data.dielectric !== null) ||
    (typeof data.water !== 'string' && data.water !== null) ||
    typeof data.status !== 'string'
  )

  const status: FluidStatus = noData
    ? 'NO_DATA'
    : hasError
      ? 'ERROR'
      : safeStatus(data.status)

  // Build the sub-metric list in canonical order. When the card is noData
  // or hasError, the list is empty (preserves the clean noData UX). When
  // live, the chemistry metrics are ALWAYS present (as "N/A" if null) and
  // Capacitance is always present. Water is only present when a numeric
  // dielectric exists (it's a derived flag, not a separate sensor).
  let secondaryMetrics: string[] = []
  if (!noData && !hasError) {
    secondaryMetrics = [
      formatEngineSubMetric('Capacitance', capacitance, ' pF'),
      // Water is only meaningful when we have a dielectric constant.
      data.dielectric !== null && data.dielectric !== undefined && data.water !== null
        ? `Water: ${data.water}`
        : null,
      formatEngineSubMetric('TBN', tbn, ' mg KOH/g'),
      formatEngineSubMetric('TAN', tan, ' mg KOH/g'),
      formatEngineSubMetric('Viscosity', viscosity, '%'),
    ].filter((s): s is string => s !== null)
  }

  return {
    kind: 'engine_oil',
    title: 'Engine Oil',
    icon: '⚙️',
    primaryMetric: noData
      ? 'No measurement yet'
      : hasError
        ? 'N/A'
        : data.dielectric === null || data.dielectric === undefined
          ? 'N/A'
          : `Dielectric ${Number(data.dielectric).toFixed(2)}`,
    secondaryMetrics,
    status,
    hasError,
    noData,
  }
}

export function mapCoolant(raw: Partial<CoolantReading> | null | undefined): FluidCardModel {
  const data = raw ?? {}
  const noData =
    !raw ||
    data.ph === null ||
    data.ph === undefined ||
    safeStatus(data.status) === 'NO_DATA'
  const hasError = !noData && (
    (typeof data.ph !== 'number') ||
    typeof data.status !== 'string'
  )

  const status: FluidStatus = noData
    ? 'NO_DATA'
    : hasError
      ? 'ERROR'
      : safeStatus(data.status)

  return {
    kind: 'coolant',
    title: 'Coolant',
    icon: '❄️',
    primaryMetric: noData
      ? 'No measurement yet'
      : hasError
        ? 'N/A'
        : `pH ${Number(data.ph).toFixed(1)}`,
    secondaryMetrics: [],
    status,
    hasError,
    noData,
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

