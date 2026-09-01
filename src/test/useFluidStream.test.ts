import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFluidStream } from '@/hooks/useFluidStream'
import type { FluidResultsResponse, WsFrame } from '@/types/fluid'

/**
 * Lightweight WebSocket mock. The hook accepts a real `WebSocket` global,
 * so we install a class-like factory on `globalThis` and capture the
 * instance for test-driven frame delivery.
 */
class MockWebSocket {
  static instances: MockWebSocket[] = []
  static OPEN = 1
  static CONNECTING = 0
  static CLOSED = 3
  static CLOSING = 2
  url: string
  readyState = 0
  onopen: ((e: Event) => void) | null = null
  onclose: ((e: Event) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  sent: string[] = []
  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
    this.onclose?.(new Event('close'))
  }
  // Test helpers
  triggerOpen() {
    this.readyState = 1
    this.onopen?.(new Event('open'))
  }
  triggerMessage(data: WsFrame) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
  triggerError() {
    this.onerror?.(new Event('error'))
  }
  triggerClose() {
    this.readyState = 3
    this.onclose?.(new Event('close'))
  }
}

beforeEach(() => {
  MockWebSocket.instances = []
  // @ts-expect-error - test global
  globalThis.WebSocket = MockWebSocket
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  // @ts-expect-error - cleanup
  delete globalThis.WebSocket
})

describe('useFluidStream', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useFluidStream())
    expect(result.current.status).toBe('idle')
    expect(result.current.data).toBeNull()
    expect(result.current.frozen).toBe(false)
    expect(result.current.isStreaming).toBe(false)
  })

  it('transitions to connecting on start(), then streaming on open', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    expect(result.current.status).toBe('connecting')
    expect(MockWebSocket.instances).toHaveLength(1)

    act(() => MockWebSocket.instances[0].triggerOpen())
    expect(result.current.status).toBe('streaming')
  })

  it('applies a snapshot frame to data and sets frozen=true', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    const payload: FluidResultsResponse = {
      brake_oil: { moisture: '2%', status: 'GOOD' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7, status: 'GOOD' }, }
    act(() => {
      MockWebSocket.instances[0].triggerMessage({ kind: 'snapshot', data: payload })
    })
    expect(result.current.data).toEqual(payload)
    expect(result.current.frozen).toBe(true)
    expect(result.current.status).toBe('streaming')
  })

  it('merges per-fluid delta frames into the existing snapshot', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    const initial: FluidResultsResponse = {
      brake_oil: { moisture: '2%', status: 'GOOD' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7, status: 'GOOD' }, }
    act(() => {
      MockWebSocket.instances[0].triggerMessage({ kind: 'snapshot', data: initial })
    })
    act(() => {
      MockWebSocket.instances[0].triggerMessage({
        kind: 'brake_oil',
        data: { moisture: '3%', status: 'WARNING' } })
    })
    expect(result.current.data?.brake_oil.moisture).toBe('3%')
    expect(result.current.data?.brake_oil.status).toBe('WARNING')
    expect(result.current.data?.engine_oil.dielectric).toBe(2.4)
    expect(result.current.data?.coolant.ph).toBe(7)
  })

  it('fill-missing fields with NO_DATA defaults on the first per-fluid frame', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    // First frame is just a brake delta (no snapshot yet)
    act(() => {
      MockWebSocket.instances[0].triggerMessage({
        kind: 'brake_oil',
        data: { moisture: '1%', status: 'NORMAL' } })
    })
    expect(result.current.data?.brake_oil.moisture).toBe('1%')
    expect(result.current.data?.engine_oil.dielectric).toBeNull()
    expect(result.current.data?.engine_oil.status).toBe('NO_DATA')
    expect(result.current.data?.coolant.ph).toBeNull()
    expect(result.current.data?.coolant.status).toBe('NO_DATA')
  })

  it('ignores heartbeat frames', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    act(() => {
      MockWebSocket.instances[0].triggerMessage({ kind: 'heartbeat', ts: Date.now() })
    })
    expect(result.current.data).toBeNull()
    expect(result.current.frozen).toBe(false)
  })

  it('ignores malformed (non-JSON) messages without crashing', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    act(() => {
      const ws = MockWebSocket.instances[0]
      ws.onmessage?.(new MessageEvent('message', { data: 'DEBUG: hello' }))
    })
    expect(result.current.status).toBe('streaming')
  })

  it('stop() closes the socket but keeps frozen=true and data intact', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    const payload: FluidResultsResponse = {
      brake_oil: { moisture: '2%', status: 'GOOD' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7, status: 'GOOD' }, }
    act(() => {
      MockWebSocket.instances[0].triggerMessage({ kind: 'snapshot', data: payload })
    })
    act(() => result.current.stop())
    expect(MockWebSocket.instances[0].readyState).toBe(3)
    expect(result.current.frozen).toBe(true)
    expect(result.current.data).toEqual(payload)
  })

  it('reconnects automatically on unexpected close', () => {
    const { result } = renderHook(() =>
      useFluidStream({ reconnectDelayMs: 1000 }),
    )
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    const firstWs = MockWebSocket.instances[0]
    act(() => firstWs.triggerClose())
    expect(result.current.status).toBe('connecting')
    act(() => {
      vi.advanceTimersByTime(1100)
    })
    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('gives up and surfaces error after maxReconnectAttempts consecutive failures', () => {
    const { result } = renderHook(() =>
      useFluidStream({ reconnectDelayMs: 100, maxReconnectAttempts: 2 }),
    )
    act(() => result.current.start())
    // Attempt #1: never opens, then closes (the "device offline" path)
    act(() => MockWebSocket.instances[0].triggerClose())
    act(() => {
      vi.advanceTimersByTime(150)
    })
    // Attempt #2: also fails
    act(() => MockWebSocket.instances[1].triggerClose())
    act(() => {
      vi.advanceTimersByTime(150)
    })
    // Attempt #3: also fails — but the hook should now give up
    act(() => MockWebSocket.instances[2].triggerClose())
    act(() => {
      vi.advanceTimersByTime(150)
    })
    // No 4th socket should appear
    expect(MockWebSocket.instances).toHaveLength(3)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBeTruthy()
  })

  it('does not reconnect after a user-initiated stop()', () => {
    const { result } = renderHook(() =>
      useFluidStream({ reconnectDelayMs: 100 }),
    )
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    act(() => result.current.stop())
    expect(MockWebSocket.instances[0].readyState).toBe(3)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('invokes onFrame for non-heartbeat frames', () => {
    const onFrame = vi.fn()
    const { result } = renderHook(() => useFluidStream({ onFrame }))
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    act(() => {
      MockWebSocket.instances[0].triggerMessage({ kind: 'heartbeat', ts: 1 })
    })
    expect(onFrame).not.toHaveBeenCalled()
    act(() => {
      MockWebSocket.instances[0].triggerMessage({
        kind: 'brake_oil',
        data: { moisture: '1%', status: 'NORMAL' } })
    })
    expect(onFrame).toHaveBeenCalledTimes(1)
  })

  it('exposes lastUpdateMs that advances on each non-heartbeat frame', () => {
    const { result } = renderHook(() => useFluidStream())
    act(() => result.current.start())
    act(() => MockWebSocket.instances[0].triggerOpen())
    expect(result.current.lastUpdateMs).toBeNull()
    act(() => {
      vi.setSystemTime(new Date('2026-09-02T10:00:00Z'))
      MockWebSocket.instances[0].triggerMessage({
        kind: 'brake_oil',
        data: { moisture: '1%', status: 'NORMAL' } })
    })
    const t1 = result.current.lastUpdateMs
    expect(t1).not.toBeNull()
    act(() => {
      vi.setSystemTime(new Date('2026-09-02T10:00:05Z'))
      MockWebSocket.instances[0].triggerMessage({
        kind: 'coolant',
        data: { ph: 7, status: 'GOOD' } })
    })
    const t2 = result.current.lastUpdateMs
    expect(t2).not.toBeNull()
    expect(t2!).toBeGreaterThan(t1!)
  })
})