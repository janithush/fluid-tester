/**
 * Domain types for the FlowMetrics fluid tester.
 * These mirror the JSON contract documented with the hardware team.
 */

export type FluidStatus =
  | 'GOOD'
  | 'NORMAL'
  | 'WARNING'
  | 'BAD'
  | 'CRITICAL'
  | 'ERROR' // synthetic, set by the UI when the reading is missing/invalid (transport failure)
  | 'NO_DATA' // synthetic, set when the sensor has never reported a reading for this fluid
  | 'UNKNOWN' // synthetic, set by the UI when the ESP32 returns an unrecognized status

export type FluidKind = 'brake_oil' | 'engine_oil' | 'coolant'

export interface BrakeOilReading {
  /** Moisture percentage as reported by the sensor, e.g. "2%". `null` when sensor has not yet reported. */
  moisture: string | null
  status: FluidStatus
}

export interface EngineOilReading {
  /** Dielectric constant (dimensionless). `null` when sensor has not yet reported. */
  dielectric: number | null
  /**
   * Capacitance in pF, computed locally by the FDC2214 in the same loop
   * as the dielectric. `null` until the operator runs an engine-oil
   * measurement (gated by `webEngineMeasurementTaken` on the firmware
   * side), so the value is never reported before the user clicks Fetch.
   */
  capacitance: number | null
  /** Water presence flag. `null` when no dielectric reading exists yet. */
  water: 'YES' | 'NO' | null
  /**
   * TBN (Total Base Number) in mg KOH/g. `null` because the chemical
   * sensor is not wired in this hardware revision; the field is part of
   * the contract so the future firmware update is a pure additive change.
   */
  tbn: number | null
  /**
   * TAN (Total Acid Number) in mg KOH/g. `null` because the chemical
   * sensor is not wired in this hardware revision; see `tbn` above.
   */
  tan: number | null
  /**
   * Viscosity as a percentage of new oil. `null` because the chemical
   * sensor is not wired in this hardware revision; see `tbn` above.
   */
  viscosity: number | null
  status: FluidStatus
}

export interface CoolantReading {
  /** pH value, typically 0-14. `null` when sensor is not wired / not yet reported. */
  ph: number | null
  status: FluidStatus
}

export interface FluidResultsResponse {
  brake_oil: BrakeOilReading
  engine_oil: EngineOilReading
  coolant: CoolantReading
}

/**
 * Real-time WebSocket frames the ESP32 pushes while a measurement stream
 * is active. The first frame on a new connection is always a full snapshot,
 * followed by per-fluid delta frames and periodic heartbeats.
 */
export type WsFrame =
  | { kind: 'snapshot'; data: FluidResultsResponse }
  | { kind: 'brake_oil'; data: BrakeOilReading }
  | { kind: 'engine_oil'; data: EngineOilReading }
  | { kind: 'coolant'; data: CoolantReading }
  | { kind: 'heartbeat'; ts: number }

export interface VehicleForm {
  date: string
  vehicleNumber: string
  kmUsage: number
}

export interface FormErrors {
  date?: string
  vehicleNumber?: string
  kmUsage?: string
}

/**
 * The view-model the UI consumes for each fluid card.
 * Defined here (not in the mapper) to avoid circular imports.
 */
export interface FluidCardModel {
  kind: 'brake_oil' | 'engine_oil' | 'coolant'
  title: string
  icon: string
  primaryMetric: string
  secondaryMetrics: string[]
  status: FluidStatus
  /** Transport / parse failure: the response was malformed or unreachable. */
  hasError: boolean
  /** The sensor has not produced a numeric reading yet (universal across fluids). */
  noData: boolean
}
