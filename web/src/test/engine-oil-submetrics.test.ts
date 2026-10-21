import { describe, it, expect } from 'vitest'
import { mapEngineOil } from '@/lib/results-mapper'
import type { EngineOilReading } from '@/types/fluid'

/**
 * Dedicated tests for the engine-oil sub-metrics introduced in Phase 3.
 * Contract:
 *   - When the card is fully noData (all 5 numeric fields null), the
 *     secondaryMetrics list is EMPTY and the card shows the "No measurement
 *     yet" / NO_DATA pill UX.
 *   - When the card is LIVE (at least one numeric field present), the
 *     sub-metric list contains Capacitance, Water (gated on dielectric),
 *     TBN, TAN, Viscosity. Chemistry fields render as "TBN: N/A" etc.
 *     when the sensor is absent.
 *   - Sub-metric order is locked: Capacitance, Water, TBN, TAN, Viscosity.
 */
describe('mapEngineOil — sub-metrics (Phase 3)', () => {
  describe('live card (partial reading)', () => {
    it('renders all 5 sub-metrics when only dielectric is present', () => {
      const m = mapEngineOil({
        dielectric: 2.4,
        capacitance: null,
        water: 'NO',
        tbn: null,
        tan: null,
        viscosity: null,
        status: 'GOOD',
      } as EngineOilReading)
      expect(m.noData).toBe(false)
      expect(m.hasError).toBe(false)
      expect(m.status).toBe('GOOD')
      expect(m.primaryMetric).toBe('Dielectric 2.40')
      expect(m.secondaryMetrics).toEqual([
        'Capacitance: N/A',
        'Water: NO',
        'TBN: N/A',
        'TAN: N/A',
        'Viscosity: N/A',
      ])
    })

    it('renders all 5 sub-metrics when dielectric is null but another numeric is present', () => {
      // Partial reading: FDC2214 failed but TBN (a future sensor) gave
      // a value. The card is LIVE (not noData) because at least one
      // numeric field is non-null.
      const m = mapEngineOil({
        dielectric: null,
        capacitance: null,
        water: null,
        tbn: 8.2,
        tan: null,
        viscosity: null,
        status: 'GOOD',
      } as unknown as EngineOilReading)
      expect(m.noData).toBe(false)
      expect(m.hasError).toBe(false)
      // The dielectric is null but the card is live -> primary is "N/A"
      expect(m.primaryMetric).toBe('N/A')
      expect(m.secondaryMetrics).toContain('TBN: 8.20 mg KOH/g')
      expect(m.secondaryMetrics).toContain('TAN: N/A')
      expect(m.secondaryMetrics).toContain('Viscosity: N/A')
      expect(m.secondaryMetrics).toContain('Capacitance: N/A')
    })

    it('formats a real Capacitance value with the pF unit', () => {
      const m = mapEngineOil({
        dielectric: 2.4,
        capacitance: 3.72,
        water: 'NO',
        tbn: null,
        tan: null,
        viscosity: null,
        status: 'GOOD',
      } as EngineOilReading)
      expect(m.secondaryMetrics).toContain('Capacitance: 3.72 pF')
    })

    it('formats TBN / TAN / Viscosity with their units when present', () => {
      const m = mapEngineOil({
        dielectric: 2.4,
        capacitance: 3.72,
        water: 'NO',
        tbn: 8.2,
        tan: 1.5,
        viscosity: 92,
        status: 'GOOD',
      } as EngineOilReading)
      expect(m.secondaryMetrics).toContain('TBN: 8.20 mg KOH/g')
      expect(m.secondaryMetrics).toContain('TAN: 1.50 mg KOH/g')
      expect(m.secondaryMetrics).toContain('Viscosity: 92.00%')
    })

    it('locks the canonical sub-metric order', () => {
      const m = mapEngineOil({
        dielectric: 2.4,
        capacitance: 3.72,
        water: 'YES',
        tbn: 8.2,
        tan: 1.5,
        viscosity: 92,
        status: 'GOOD',
      } as EngineOilReading)
      expect(m.secondaryMetrics).toEqual([
        'Capacitance: 3.72 pF',
        'Water: YES',
        'TBN: 8.20 mg KOH/g',
        'TAN: 1.50 mg KOH/g',
        'Viscosity: 92.00%',
      ])
    })

    it('omits Water when dielectric is null even if water is "YES"', () => {
      const m = mapEngineOil({
        dielectric: null,
        capacitance: 3.72,
        water: 'YES',
        tbn: null,
        tan: null,
        viscosity: null,
        status: 'GOOD',
      } as EngineOilReading)
      expect(m.noData).toBe(false)
      // Water without a dielectric constant is physically meaningless.
      expect(m.secondaryMetrics.find((s) => s.startsWith('Water:'))).toBeUndefined()
    })
  })

  describe('noData card (all numeric fields null)', () => {
    it('has empty secondaryMetrics and primary "No measurement yet"', () => {
      const m = mapEngineOil({
        dielectric: null,
        capacitance: null,
        water: null,
        tbn: null,
        tan: null,
        viscosity: null,
        status: 'NO_DATA',
      } as EngineOilReading)
      expect(m.noData).toBe(true)
      expect(m.hasError).toBe(false)
      expect(m.status).toBe('NO_DATA')
      expect(m.primaryMetric).toBe('No measurement yet')
      // The dashed-border noData UX must NOT show the chemistry lines.
      expect(m.secondaryMetrics).toEqual([])
    })

    it('handles a null payload as noData', () => {
      const m = mapEngineOil(null)
      expect(m.noData).toBe(true)
      expect(m.secondaryMetrics).toEqual([])
    })

    it('handles a legacy payload (no new fields) as noData when status is NO_DATA', () => {
      const m = mapEngineOil({
        dielectric: null,
        water: null,
        status: 'NO_DATA',
      } as EngineOilReading)
      expect(m.noData).toBe(true)
      expect(m.secondaryMetrics).toEqual([])
    })
  })

  describe('backward-compat with legacy payloads', () => {
    it('tolerates a payload missing the new fields when the card is live', () => {
      // Legacy ESP32 sends {dielectric, water, status} only. The
      // mapper must coerce the missing fields to null and render the
      // "N/A" sub-metric lines so the user can see what the system
      // is tracking.
      const m = mapEngineOil({
        dielectric: 2.15,
        water: 'NO',
        status: 'GOOD',
      } as EngineOilReading)
      expect(m.noData).toBe(false)
      expect(m.hasError).toBe(false)
      expect(m.secondaryMetrics).toEqual([
        'Capacitance: N/A',
        'Water: NO',
        'TBN: N/A',
        'TAN: N/A',
        'Viscosity: N/A',
      ])
    })

    it('tolerates a legacy payload missing the new fields when status is NO_DATA', () => {
      const m = mapEngineOil({
        dielectric: null,
        water: null,
        status: 'NO_DATA',
      } as EngineOilReading)
      expect(m.noData).toBe(true)
      expect(m.secondaryMetrics).toEqual([])
    })
  })

  describe('error cases', () => {
    it('flags hasError when dielectric is a non-null wrong type', () => {
      const m = mapEngineOil({
        dielectric: 'two point one' as unknown as number,
        capacitance: null,
        water: 'NO',
        tbn: null,
        tan: null,
        viscosity: null,
        status: 'GOOD',
      } as EngineOilReading)
      expect(m.hasError).toBe(true)
      expect(m.noData).toBe(false)
      expect(m.status).toBe('ERROR')
      expect(m.primaryMetric).toBe('N/A')
    })

    it('does not flag hasError when only a new chemistry field is wrong type', () => {
      // The mapper is lenient about the new fields: missing or wrong
      // type both coerce to null and render as "N/A".
      const m = mapEngineOil({
        dielectric: 2.4,
        capacitance: null,
        water: 'NO',
        tbn: 'eight' as unknown as number,
        tan: null,
        viscosity: null,
        status: 'GOOD',
      } as EngineOilReading)
      expect(m.noData).toBe(false)
      expect(m.hasError).toBe(false)
      expect(m.secondaryMetrics).toContain('TBN: N/A')
    })
  })
})
