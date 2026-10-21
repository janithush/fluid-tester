import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  VEHICLE_NUMBER_REGEX,
  validateForm,
} from '@/lib/form-validation'
import {
  BRAKE_PROFILES,
  ENGINE_PROFILES,
  evaluateAgainstProfile,
  evaluateAllResults,
  getProfile,
} from '@/lib/fluid-profiles'
import { CSV_HEADERS, toSessionCsv, toSessionJson } from '@/lib/export'
import {
  listRunsByVehicle,
  resetRunsStoreFactory,
  saveRun,
  setRunsStoreFactoryForTests,
} from '@/lib/history-db'
import type { DiagnosticRun, RunsStore } from '@/lib/history-db'
import type { FluidCardModel } from '@/lib/results-mapper'
import type { VehicleForm } from '@/types/fluid'

function card(partial: Partial<FluidCardModel> & Pick<FluidCardModel, 'kind' | 'primaryMetric' | 'status'>): FluidCardModel {
  return {
    title: '',
    icon: '',
    secondaryMetrics: [],
    hasError: false,
    noData: false,
    rawStatus: partial.status,
    ...partial,
  } as FluidCardModel
}

const baseForm: VehicleForm = {
  date: '2026-10-22',
  vehicleNumber: 'WP-CAB-1234',
  kmUsage: 25000,
}

const sampleResults: FluidCardModel[] = [
  card({ kind: 'brake_oil', title: 'Brake Oil', primaryMetric: '3% moisture', status: 'NORMAL', rawStatus: 'NORMAL' }),
  card({ kind: 'engine_oil', title: 'Engine Oil', primaryMetric: 'Dielectric 2.40', status: 'GOOD', rawStatus: 'GOOD' }),
  card({ kind: 'coolant', title: 'Coolant', primaryMetric: 'pH 7.0', status: 'NO_DATA', hasError: false, noData: true }),
]

describe('Tier 1: vehicle plate regex', () => {
  it('accepts workshop plates with hyphens, spaces, letters and digits', () => {
    expect(VEHICLE_NUMBER_REGEX.test('WP-CAB-1234')).toBe(true)
    expect(VEHICLE_NUMBER_REGEX.test('CAB 1234')).toBe(true)
    expect(VEHICLE_NUMBER_REGEX.test('ABC1234')).toBe(true)
  })

  it('rejects symbols, empty/short and oversized values', () => {
    expect(VEHICLE_NUMBER_REGEX.test('AB@12')).toBe(false)
    expect(VEHICLE_NUMBER_REGEX.test('AB!')).toBe(false)
    expect(VEHICLE_NUMBER_REGEX.test('AB')).toBe(false) // below 3 chars
    expect(VEHICLE_NUMBER_REGEX.test('A'.repeat(16))).toBe(false) // above 15 chars
  })

  it('validateForm wires the new contract end to end', () => {
    expect(validateForm({ ...baseForm, vehicleNumber: 'WP-CAB-1234' }).vehicleNumber).toBeUndefined()
    expect(validateForm({ ...baseForm, vehicleNumber: 'AB@12' }).vehicleNumber).toBeDefined()
  })
})

describe('Tier 1: fluid threshold profiles (F1)', () => {
  it('registers the speced brake and engine profile families', () => {
    expect(BRAKE_PROFILES.map((p) => p.id)).toEqual(['dot-3', 'dot-4', 'dot-5.1'])
    expect(ENGINE_PROFILES.map((p) => p.id)).toEqual(['mineral-20w50', 'semi-10w40', 'synth-5w30'])
  })

  it('re-grades the same 3% moisture differently under DOT 3 vs DOT 4', () => {
    const brakeCard = card({
      kind: 'brake_oil',
      title: 'Brake Oil',
      primaryMetric: '3% moisture',
      status: 'NORMAL',
      rawStatus: 'NORMAL',
    })
    // DOT 3: critical >= 3% -> CRITICAL. DOT 4: warn >= 3% -> WARNING.
    const dot3 = evaluateAgainstProfile(brakeCard, 'dot-3')
    const dot4 = evaluateAgainstProfile(brakeCard, 'dot-4')
    expect(dot3?.grade).toBe('CRITICAL')
    expect(dot4?.grade).toBe('WARNING')
  })

  it('keeps 2% at GOOD for DOT 4 but flags it WARNING for DOT 3', () => {
    const brakeCard = card({
      kind: 'brake_oil',
      title: 'Brake Oil',
      primaryMetric: '2% moisture',
      status: 'NORMAL',
      rawStatus: 'NORMAL',
    })
    expect(evaluateAgainstProfile(brakeCard, 'dot-3')?.grade).toBe('WARNING')
    expect(evaluateAgainstProfile(brakeCard, 'dot-4')?.grade).toBe('GOOD')
  })

  it('grades engine oil dielectric drift vs the profile baseline', () => {
    const oilCard = (er: string) =>
      card({ kind: 'engine_oil', title: 'Engine Oil', primaryMetric: er, status: 'GOOD', rawStatus: 'GOOD' })

    // Mineral baseline 2.15: 2.20 is +0.05 -> WARNING; synth baseline 2.35 keeps 2.20 as degradation-free GOOD.
    expect(evaluateAgainstProfile(oilCard('Dielectric 2.20'), 'mineral-20w50')?.grade).toBe('WARNING')
    expect(evaluateAgainstProfile(oilCard('Dielectric 2.20'), 'synth-5w30')?.grade).toBe('GOOD')
    // +0.20 drift lands CRITICAL on every profile.
    expect(evaluateAgainstProfile(oilCard('Dielectric 2.55'), 'mineral-20w50')?.grade).toBe('CRITICAL')
    // Absolute water-intrusion limit still wins even for "high baseline" profiles.
    expect(evaluateAgainstProfile(oilCard('Dielectric 2.90'), 'synth-5w30')?.grade).toBe('CRITICAL')
  })

  it('returns null for unknown profiles, kind mismatches or no-data cards', () => {
    expect(evaluateAgainstProfile(sampleResults[0], 'synth-5w30')).toBeNull()
    expect(evaluateAgainstProfile(sampleResults[0], 'dot-999')).toBeNull()
    expect(evaluateAgainstProfile(sampleResults[2], 'dot-4')).toBeNull()
    const empty = card({ kind: 'engine_oil', title: 'Engine Oil', primaryMetric: 'No measurement yet', status: 'NO_DATA', noData: true })
    expect(evaluateAgainstProfile(empty, 'synth-5w30')).toBeNull()
  })

  it('evaluateAllResults applies one selection across the card set', () => {
    const evaluations = evaluateAllResults(sampleResults, {
      brakeProfileId: 'dot-4',
      engineProfileId: 'semi-10w40',
    })
    expect(evaluations.brake_oil?.grade).toBe('WARNING') // 3% == DOT 4 warn threshold
    expect(evaluations.engine_oil?.grade).toBe('WARNING') // 2.40 vs 2.25 baseline
    expect(evaluations.coolant).toBeNull()
  })

  it('getProfile resolves every seeded id', () => {
    for (const p of [...BRAKE_PROFILES, ...ENGINE_PROFILES]) {
      expect(getProfile(p.id)?.id).toBe(p.id)
    }
  })
})

describe('Tier 1: CSV / JSON session export (F5)', () => {
  it('starts with the required header row and includes one row per fluid', () => {
    const csv = toSessionCsv({ form: baseForm, results: sampleResults })
    const lines = csv.replace(/\r\n$/, '').split('\r\n')
    expect(lines[0]).toBe(CSV_HEADERS.join(','))
    expect(lines).toHaveLength(4) // header + 3 fluids

    // Header covers the speced columns: timestamp, vehicle, km, fluids,
    // readings, dielectric / capacitance, status words.
    for (const col of ['Timestamp', 'Vehicle No', 'Km Usage', 'Fluid', 'Reading', 'Dielectric', 'Capacitance (pF)', 'Status']) {
      expect(CSV_HEADERS).toContain(col as (typeof CSV_HEADERS)[number])
    }

    // Brake row carries the reading + status; engine row the dielectric.
    expect(lines[1]).toContain(`,${baseForm.vehicleNumber},`)
    expect(lines[1]).toContain(',Brake Oil,3% moisture,')
    expect(lines[1]).toContain(`,${baseForm.kmUsage},Brake Oil`)
    expect(lines[1].endsWith(',NORMAL')).toBe(true)
    expect(lines[2]).toContain(',2.40,') // dielectric cell (parser keeps metric precision)
  })

  it('escapes commas and quotes per RFC 4180 and never emits fabricated values', () => {
    const noData = [...sampleResults]
    const csv = toSessionCsv({
      form: { ...baseForm, vehicleNumber: 'A,B "1' },
      results: noData,
    })
    expect(csv).toContain('"A,B ""1"')

    // The noData coolant row keeps Status=NO_DATA with a blank dielectric.
    const coolantRow = csv.split('\r\n')[3]
    expect(coolantRow).toContain(',Coolant,No measurement')
  })

  it('JSON export embeds the full session structure', () => {
    const parsed = JSON.parse(toSessionJson({ form: baseForm, results: sampleResults })) as {
      exportedAt: string
      form: VehicleForm
      results: FluidCardModel[]
    }
    expect(parsed.form).toEqual(baseForm)
    expect(parsed.results).toHaveLength(3)
    expect(new Date(parsed.exportedAt).getTime()).not.toBeNaN()
  })
})

describe('Tier 1: IndexedDB vehicle history (F4)', () => {
  let memoryId = 0
  let rows: DiagnosticRun[]

  const memoryStore: RunsStore = {
    async put(value) {
      const id = value.id ?? ++memoryId
      const record: DiagnosticRun = { ...value, id }
      rows = rows.filter((r) => r.id !== id)
      rows.push(record)
      return id
    },
    async getAll() {
      return [...rows]
    },
    async delete(key) {
      rows = rows.filter((r) => r.id !== key)
    },
  }

  beforeEach(() => {
    memoryId = 0
    rows = []
    setRunsStoreFactoryForTests(async () => memoryStore)
  })
  afterEach(() => {
    resetRunsStoreFactory()
  })

  it('saves runs and retrieves them by exact vehicle number (newest first)', async () => {
    const runA = {
      vehicleNumber: 'WP-CAB-1234',
      date: '2026-03-01',
      kmUsage: 10000,
      createdAt: 1_000,
      brakeProfileId: 'dot-3',
      engineProfileId: 'mineral-20w50',
      firmwareRaw: {} as DiagnosticRun['firmwareRaw'],
      cards: [],
    }
    const runB = { ...runA, kmUsage: 25000, createdAt: 2_000 }
    const other = { ...runA, vehicleNumber: 'ABC1234', createdAt: 3_000 }

    await saveRun(runA)
    await saveRun(runB)
    await saveRun(other)

    const found = await listRunsByVehicle('WP-CAB-1234')
    expect(found).toHaveLength(2)
    // Newest first: createdAt 2000 before 1000.
    expect(found.map((r) => r.kmUsage)).toEqual([25000, 10000])
    expect(found[0].brakeProfileId).toBe('dot-3')

    // Trimming must not defeat the lookup, and casing must not either:
    // operators type "add2501" while the stored plate is "ADD2501".
    expect(await listRunsByVehicle('  WP-CAB-1234 ')).toHaveLength(2)
    expect(await listRunsByVehicle('wp-cab-1234')).toHaveLength(2)
    expect(await listRunsByVehicle('UNKNOWN-PLATE')).toHaveLength(0)
  })

  it('stores the raw snapshot + mapped cards alongside the metadata', async () => {
    await saveRun({
      vehicleNumber: 'CAB 1234',
      date: '2026-10-22',
      kmUsage: 40000,
      createdAt: 5_000,
      brakeProfileId: 'dot-4',
      engineProfileId: 'synth-5w30',
      firmwareRaw: {
        brake_oil: { moisture: '2%', status: 'NORMAL' },
        engine_oil: { dielectric: 2.4, capacitance: null, water: 'NO', tbn: null, tan: null, viscosity: null, status: 'GOOD' },
        coolant: { ph: null, status: 'NO_DATA' },
      },
      cards: sampleResults,
    })
    const [run] = await listRunsByVehicle('CAB 1234')
    expect(run.firmwareRaw.engine_oil.dielectric).toBe(2.4)
    expect(run.cards).toHaveLength(3)
    expect(run.engineProfileId).toBe('synth-5w30')
  })
})
