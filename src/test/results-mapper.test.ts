import { describe, it, expect } from 'vitest'
import {
  mapAllResults,
  mapBrakeOil,
  mapCoolant,
  mapEngineOil,
} from '@/lib/results-mapper'

describe('mapBrakeOil', () => {
  it('maps a valid reading', () => {
    const m = mapBrakeOil({ moisture: '2%', status: 'WARNING' })
    expect(m.kind).toBe('brake_oil')
    expect(m.status).toBe('WARNING')
    expect(m.hasError).toBe(false)
    expect(m.primaryMetric).toContain('2%')
  })

  it('flags as error when moisture missing', () => {
    const m = mapBrakeOil({ status: 'GOOD' } as never)
    expect(m.hasError).toBe(true)
    expect(m.status).toBe('ERROR')
    expect(m.primaryMetric).toBe('N/A')
  })

  it('flags as error when status missing', () => {
    const m = mapBrakeOil({ moisture: '3%' } as never)
    expect(m.hasError).toBe(true)
  })

  it('handles null gracefully', () => {
    const m = mapBrakeOil(null)
    expect(m.hasError).toBe(true)
  })

  it('marks unknown status as UNKNOWN (not CRITICAL or GOOD)', () => {
    const m = mapBrakeOil({ moisture: '1%', status: 'WHO_KNOWS' as never })
    expect(m.hasError).toBe(false)
    expect(m.status).toBe('UNKNOWN')
  })
})

describe('mapEngineOil', () => {
  it('maps a valid reading with secondary metrics', () => {
    const m = mapEngineOil({ dielectric: 2.15, water: 'NO', status: 'GOOD' })
    expect(m.status).toBe('GOOD')
    expect(m.hasError).toBe(false)
    expect(m.primaryMetric).toContain('2.15')
    expect(m.secondaryMetrics).toContain('Water: NO')
  })

  it('flags as error when dielectric is not a number', () => {
    const m = mapEngineOil({ dielectric: '2.15', water: 'NO', status: 'GOOD' } as never)
    expect(m.hasError).toBe(true)
  })

  it('handles null', () => {
    expect(mapEngineOil(null).hasError).toBe(true)
  })
})

describe('mapCoolant', () => {
  it('maps a valid reading', () => {
    const m = mapCoolant({ ph: 7.5, status: 'GOOD' })
    expect(m.status).toBe('GOOD')
    expect(m.primaryMetric).toContain('7.5')
  })

  it('flags as error on missing ph', () => {
    const m = mapCoolant({ status: 'GOOD' } as never)
    expect(m.hasError).toBe(true)
  })
})

describe('mapAllResults', () => {
  it('returns 3 cards in the canonical order', () => {
    const cards = mapAllResults({
      brake_oil: { moisture: '2%', status: 'GOOD' },
      engine_oil: { dielectric: 2.1, water: 'NO', status: 'BAD' },
      coolant: { ph: 8.0, status: 'CRITICAL' },
    })
    expect(cards).toHaveLength(3)
    expect(cards.map((c) => c.kind)).toEqual(['brake_oil', 'engine_oil', 'coolant'])
    expect(cards[0].status).toBe('GOOD')
    expect(cards[1].status).toBe('BAD')
    expect(cards[2].status).toBe('CRITICAL')
  })

  it('flags every card as error when the response is null', () => {
    const cards = mapAllResults(null)
    expect(cards.every((c) => c.hasError)).toBe(true)
  })

  it('flags only the affected card when one fluid is missing', () => {
    const cards = mapAllResults({
      brake_oil: { moisture: '1%', status: 'GOOD' },
      engine_oil: null as never,
      coolant: { ph: 7, status: 'GOOD' },
    })
    expect(cards[0].hasError).toBe(false)
    expect(cards[1].hasError).toBe(true)
    expect(cards[2].hasError).toBe(false)
  })
})
