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
  | 'ERROR' // synthetic, set by the UI when reading is missing/invalid
  | 'UNKNOWN' // synthetic, set by the UI when the ESP32 returns an unrecognized status

export type FluidKind = 'brake_oil' | 'engine_oil' | 'coolant'

export interface BrakeOilReading {
  /** Moisture percentage as reported by the sensor, e.g. "2%" */
  moisture: string
  status: FluidStatus
}

export interface EngineOilReading {
  /** Dielectric constant (dimensionless) */
  dielectric: number
  /** Water presence flag */
  water: 'YES' | 'NO'
  status: FluidStatus
}

export interface CoolantReading {
  /** pH value, typically 0-14 */
  ph: number
  status: FluidStatus
}

export interface FluidResultsResponse {
  brake_oil: BrakeOilReading
  engine_oil: EngineOilReading
  coolant: CoolantReading
}

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
  hasError: boolean
}
