import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFluidStream } from '@/hooks/useFluidStream'
import { fetchFluidResults } from '@/lib/api'
import { mapAllResults, mapEngineOil } from '@/lib/results-mapper'
import type { EngineOilReading, FluidResultsResponse } from '@/types/fluid'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  url: string
  readyState = 0
  onopen: ((e: Event) => void) | null = null
  onclose: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  close() {
    this.readyState = 3
    this.onclose?.(new Event('close'))
  }
  triggerOpen() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  triggerMessage(data: unknown) {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(data) }),
    )
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  MockWebSocket.instances = []
  // @ts-expect-error - test cleanup
  delete globalThis.WebSocket
})

describe('ESP32 engine contract — new sub-metrics', () => {
  it('legacy 3-field engine_oil payload renders Capacitance/TBN/TAN/Viscosity as N/A', async () => {
    const legacy = {
      brake_oil: { moisture: '1%', status: 'NORMAL' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD' },
      coolant: { ph: 7.0, status: 'GOOD' },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(legacy),
      }),
    )
    const cards = mapAllResults(await fetchFluidResults())
    const engine = cards[1]
    expect(engine.kind).toBe('engine_oil')
    expect(engine.noData).toBe(false)
    expect(engine.secondaryMetrics).toEqual([
      'Capacitance: N/A',
      'Water: NO',
      'TBN: N/A',
      'TAN: N/A',
      'Viscosity: N/A',
    ])
  })

  it('new 7-field engine_oil payload with all nulls renders live with N/A lines', async () => {
    const modern = {
      brake_oil: { moisture: '1%', status: 'NORMAL' },
      engine_oil: {
        dielectric: 2.4,
        capacitance: null,
        water: 'NO',
        tbn: null,
        tan: null,
        viscosity: null,
        status: 'GOOD',
      },
      coolant: { ph: 7.0, status: 'GOOD' },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(modern),
      }),
    )
    const cards = mapAllResults(await fetchFluidResults())
    expect(cards[1].noData).toBe(false)
    expect(cards[1].secondaryMetrics).toContain('TBN: N/A')
    expect(cards[1].secondaryMetrics).toContain('TAN: N/A')
    expect(cards[1].secondaryMetrics).toContain('Viscosity: N/A')
  })

  it('new 7-field engine_oil payload with capacitance populated renders "Capacitance: 3.72 pF"', () => {
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

  it('hypothetical future payload with all chemistry values renders units', () => {
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

  it('all 5 numeric fields null + status NO_DATA -> noData card, empty sub-metrics', () => {
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
    expect(m.secondaryMetrics).toEqual([])
  })

  it('all 5 numeric fields null + status GOOD -> still considered live', () => {
    // Per the universal noData rule: noData requires all 5 fields null
    // AND status === 'NO_DATA'. If status is anything else (including
    // GOOD), the card is live even with null numerics. This is the
    // Scenario X product decision.
    const m = mapEngineOil({
      dielectric: null,
      capacitance: null,
      water: null,
      tbn: null,
      tan: null,
      viscosity: null,
      status: 'GOOD',
    } as EngineOilReading)
    expect(m.noData).toBe(false)
    expect(m.status).toBe('GOOD')
  })
})

describe('useFluidStream — round-trip of new engine_oil fields', () => {
  beforeEach(() => {
    // @ts-expect-error - test global
    globalThis.WebSocket = MockWebSocket
  })

  it('preserves the new fields through a snapshot frame', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    const payload: FluidResultsResponse = {
      brake_oil: { moisture: '1%', status: 'NORMAL' },
      engine_oil: {
        dielectric: 2.4,
        capacitance: 3.72,
        water: 'NO',
        tbn: 8.2,
        tan: 1.5,
        viscosity: 92,
        status: 'GOOD',
      },
      coolant: { ph: 7.0, status: 'GOOD' },
    }
    act(() => {
      MockWebSocket.instances[0].triggerMessage({
        kind: 'snapshot',
        data: payload,
      })
    })
    expect(result.current.data?.engine_oil.capacitance).toBe(3.72)
    expect(result.current.data?.engine_oil.tbn).toBe(8.2)
    expect(result.current.data?.engine_oil.tan).toBe(1.5)
    expect(result.current.data?.engine_oil.viscosity).toBe(92)
  })

  it('an engine_oil delta frame replaces the whole engine_oil object (new fields ride along)', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    act(() => {
      MockWebSocket.instances[0].triggerMessage({
        kind: 'snapshot',
        data: {
          brake_oil: { moisture: '1%', status: 'NORMAL' },
          engine_oil: {
            dielectric: 2.4,
            capacitance: null,
            water: 'NO',
            tbn: null,
            tan: null,
            viscosity: null,
            status: 'GOOD',
          },
          coolant: { ph: 7.0, status: 'GOOD' },
        },
      })
    })
    act(() => {
      MockWebSocket.instances[0].triggerMessage({
        kind: 'engine_oil',
        data: {
          dielectric: 2.5,
          capacitance: 3.8,
          water: 'NO',
          tbn: 9.1,
          tan: 1.7,
          viscosity: 88,
          status: 'GOOD',
        },
      })
    })
    expect(result.current.data?.engine_oil.dielectric).toBe(2.5)
    expect(result.current.data?.engine_oil.capacitance).toBe(3.8)
    expect(result.current.data?.engine_oil.tbn).toBe(9.1)
    expect(result.current.data?.engine_oil.viscosity).toBe(88)
    expect(result.current.data?.brake_oil.moisture).toBe('1%')
    expect(result.current.data?.coolant.ph).toBe(7.0)
  })
})
