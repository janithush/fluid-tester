import { describe, it, expect } from 'vitest'
import {
  mapAllResults,
  mapBrakeOil,
  mapCoolant,
  mapEngineOil } from '@/lib/results-mapper'

describe('mapBrakeOil', () => {
  it('maps a valid reading', () => {
    const m = mapBrakeOil({ moisture: '2%', status: 'WARNING' })
    expect(m.kind).toBe('brake_oil')
    expect(m.status).toBe('WARNING')
    expect(m.hasError).toBe(false)
    expect(m.noData).toBe(false)
    expect(m.primaryMetric).toContain('2%')
  })

  it('flags as noData (not error) when moisture is null', () => {
    const m = mapBrakeOil({ moisture: null, status: 'NO_DATA' } as never)
    expect(m.noData).toBe(true)
    expect(m.hasError).toBe(false)
    expect(m.status).toBe('NO_DATA')
    expect(m.primaryMetric).toBe('No measurement yet')
  })

  it('flags as noData when moisture is undefined', () => {
    const m = mapBrakeOil({ status: 'GOOD' } as never)
    expect(m.noData).toBe(true)
    expect(m.hasError).toBe(false)
  })

  it('handles null gracefully as noData', () => {
    const m = mapBrakeOil(null)
    expect(m.noData).toBe(true)
    expect(m.hasError).toBe(false)
    expect(m.status).toBe('NO_DATA')
  })

  it('flags as error when moisture is the wrong type', () => {
    const m = mapBrakeOil({ moisture: 42, status: 'GOOD' } as never)
    expect(m.hasError).toBe(true)
    expect(m.noData).toBe(false)
  })

  it('marks unknown status as UNKNOWN (not CRITICAL or GOOD)', () => {
    const m = mapBrakeOil({ moisture: '1%', status: 'WHO_KNOWS' as never })
    expect(m.hasError).toBe(false)
    expect(m.noData).toBe(false)
    expect(m.status).toBe('UNKNOWN')
  })
})

describe('mapEngineOil', () => {
  it('maps a valid reading with secondary metrics', () => {
    const m = mapEngineOil({ dielectric: 2.15, water: 'NO', status: 'GOOD' })
    expect(m.status).toBe('GOOD')
    expect(m.hasError).toBe(false)
    expect(m.noData).toBe(false)
    expect(m.primaryMetric).toContain('2.15')
    expect(m.secondaryMetrics).toContain('Water: NO')
  })

  it('flags as noData when dielectric is null', () => {
    const m = mapEngineOil({ dielectric: null, water: null, status: 'NO_DATA' } as never)
    expect(m.noData).toBe(true)
    expect(m.hasError).toBe(false)
    expect(m.status).toBe('NO_DATA')
    expect(m.primaryMetric).toBe('No measurement yet')
  })

  it('flags as error when dielectric is the wrong type', () => {
    const m = mapEngineOil({ dielectric: '2.15', water: 'NO', status: 'GOOD' } as never)
    expect(m.hasError).toBe(true)
    expect(m.noData).toBe(false)
  })

  it('handles null as noData', () => {
    const m = mapEngineOil(null)
    expect(m.noData).toBe(true)
    expect(m.hasError).toBe(false)
  })
})

describe('mapCoolant', () => {
  it('maps a valid reading', () => {
    const m = mapCoolant({ ph: 7.5, status: 'GOOD' })
    expect(m.status).toBe('GOOD')
    expect(m.noData).toBe(false)
    expect(m.primaryMetric).toContain('7.5')
  })

  it('flags as noData when ph is null', () => {
    const m = mapCoolant({ ph: null, status: 'NO_DATA' } as never)
    expect(m.noData).toBe(true)
    expect(m.hasError).toBe(false)
    expect(m.primaryMetric).toBe('No measurement yet')
  })

  it('flags as noData when ph is undefined', () => {
    const m = mapCoolant({ status: 'GOOD' } as never)
    expect(m.noData).toBe(true)
    expect(m.hasError).toBe(false)
  })
})

describe('mapAllResults', () => {
  it('returns 3 cards in the canonical order', () => {
    const cards = mapAllResults({
      brake_oil: { moisture: '2%', status: 'GOOD' },
      engine_oil: { dielectric: 2.1, water: 'NO', status: 'BAD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 8.0, status: 'CRITICAL' }, })
    expect(cards).toHaveLength(3)
    expect(cards.map((c) => c.kind)).toEqual(['brake_oil', 'engine_oil', 'coolant'])
    expect(cards[0].status).toBe('GOOD')
    expect(cards[1].status).toBe('BAD')
    expect(cards[2].status).toBe('CRITICAL')
  })

  it('flags every card as noData when the response is null', () => {
    const cards = mapAllResults(null)
    expect(cards.every((c) => c.noData)).toBe(true)
    expect(cards.every((c) => !c.hasError)).toBe(true)
  })

  it('flags only the affected card as noData when one fluid is missing', () => {
    const cards = mapAllResults({
      brake_oil: { moisture: '1%', status: 'GOOD' },
      engine_oil: null as never,
      coolant: { ph: 7, status: 'GOOD' }, })
    expect(cards[0].noData).toBe(false)
    expect(cards[1].noData).toBe(true)
    expect(cards[2].noData).toBe(false)
  })

  it('renders coolant card with noData when sensor absent (the "fake pH" regression)', () => {
    const cards = mapAllResults({
      brake_oil: { moisture: '1%', status: 'NORMAL' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: null, status: 'NO_DATA' }, })
    expect(cards[2].noData).toBe(true)
    expect(cards[2].status).toBe('NO_DATA')
    expect(cards[2].primaryMetric).toBe('No measurement yet')
  })

  it('renders brake card with noData before any UART has arrived (the "UNKNOWN" regression)', () => {
    const cards = mapAllResults({
      brake_oil: { moisture: null, status: 'NO_DATA' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7, status: 'GOOD' }, })
    expect(cards[0].noData).toBe(true)
    expect(cards[0].status).toBe('NO_DATA')
    // No literal "Status: NORMAL" leaks into the UI
    expect(cards[0].primaryMetric).not.toMatch(/Status:/)
  })
})

