import { useCallback, useEffect, useRef, useState } from 'react'
import { DeviceDisconnectedError } from '@/lib/api'
import type {
  FluidResultsResponse,
  WsFrame,
} from '@/types/fluid'

/**
 * High-level state of the WebSocket stream. This is the public surface
 * the UI consumes; the underlying WebSocket lifecycle is encapsulated.
 */
export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'error'

export interface UseFluidStreamState {
  status: StreamStatus
  data: FluidResultsResponse | null
  error: Error | null
  lastUpdateMs: number | null
}

export interface UseFluidStreamOptions {
  /** ws:// or wss:// endpoint. Default matches the ESP32 firmware convention. */
  url?: string
  /** Reconnect delay (ms) on unexpected close. Default 2000. */
  reconnectDelayMs?: number
  /** Max consecutive reconnect attempts before giving up. Default Infinity. */
  maxReconnectAttempts?: number
  /** Optional callback fired on every non-heartbeat frame. */
  onFrame?: (frame: WsFrame) => void
}

export interface UseFluidStreamApi extends UseFluidStreamState {
  /** Open the WebSocket and start streaming. Idempotent. */
  start: () => void
  /** Close the WebSocket and freeze the last data on screen. */
  stop: () => void
  /** True iff data is currently being streamed (not idle / not stopped). */
  isStreaming: boolean
  /**
   * True iff at least one snapshot has been received since the last
   * `start()`. Used to gate the "Generate Report" button on a frozen frame.
   */
  frozen: boolean
}

/**
 * React hook that manages a WebSocket connection to the ESP32 fluid
 * tester. Frames are merged into a single `FluidResultsResponse` snapshot
 * that the UI maps via `mapAllResults`.
 *
 * Contract:
 * - `start()` opens the socket and flips status to 'connecting' then
 *   'streaming' on the first frame.
 * - `stop()` closes the socket; `frozen` becomes true.
 * - Errors and unexpected closes trigger a reconnect loop with a fixed
 *   delay. After `maxReconnectAttempts` failures, status becomes 'error'
 *   and the last error is exposed.
 * - The hook is safe to use in React 18 StrictMode (the cleanup callback
 *   tears down the socket and the reconnect timer).
 */
export function useFluidStream(
  options: UseFluidStreamOptions = {},
): UseFluidStreamApi {
  const {
    url = 'ws://fluidtester.local/ws',
    reconnectDelayMs = 2000,
    maxReconnectAttempts = Number.POSITIVE_INFINITY,
    onFrame,
  } = options

  const [state, setState] = useState<UseFluidStreamState>({
    status: 'idle',
    data: null,
    error: null,
    lastUpdateMs: null,
  })

  // `frozen` is true the moment a snapshot frame has been received. It
  // remains true even after stop() (so the report button stays enabled).
  const [frozen, setFrozen] = useState(false)

  // Refs to the live WebSocket and reconnect timer. They survive renders
  // and let the cleanup callback reach the current instance.
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stoppedByUserRef = useRef(false)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  // The "apply a frame" function is stable across renders.
  const applyFrame = useCallback((frame: WsFrame) => {
    if (frame.kind === 'heartbeat') return
    onFrameRef.current?.(frame)
    setFrozen(true)
    setState((prev) => {
      const ts = Date.now()
      switch (frame.kind) {
        case 'snapshot':
          return { status: 'streaming', data: frame.data, error: null, lastUpdateMs: ts }
        case 'brake_oil': {
          const next: FluidResultsResponse = {
            brake_oil: frame.data,
            engine_oil: prev.data?.engine_oil ?? {
              dielectric: null,
              capacitance: null,
              water: null,
              tbn: null,
              tan: null,
              viscosity: null,
              status: 'NO_DATA',
            },
            coolant: prev.data?.coolant ?? { ph: null, status: 'NO_DATA' },
          }
          return { ...prev, data: next, lastUpdateMs: ts }
        }
        case 'engine_oil': {
          const next: FluidResultsResponse = {
            brake_oil: prev.data?.brake_oil ?? { moisture: null, status: 'NO_DATA' },
            engine_oil: frame.data,
            coolant: prev.data?.coolant ?? { ph: null, status: 'NO_DATA' },
          }
          return { ...prev, data: next, lastUpdateMs: ts }
        }
        case 'coolant': {
          const next: FluidResultsResponse = {
            brake_oil: prev.data?.brake_oil ?? { moisture: null, status: 'NO_DATA' },
            engine_oil: prev.data?.engine_oil ?? {
              dielectric: null,
              capacitance: null,
              water: null,
              tbn: null,
              tan: null,
              viscosity: null,
              status: 'NO_DATA',
            },
            coolant: frame.data,
          }
          return { ...prev, data: next, lastUpdateMs: ts }
        }
        default:
          return prev
      }
    })
  }, [])

  const clearReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])

  const connect = useCallback(() => {
    clearReconnect()
    // Don't open a second socket if one is already open/connecting.
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    setState((prev) => ({ ...prev, status: 'connecting', error: null }))

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err : new DeviceDisconnectedError(),
      }))
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0
      setState((prev) => ({ ...prev, status: 'streaming', error: null }))
    }

    ws.onmessage = (event) => {
      let parsed: WsFrame
      try {
        parsed = JSON.parse(event.data as string) as WsFrame
      } catch {
        // Ignore non-JSON frames (the ESP32 sometimes emits debug text).
        return
      }
      applyFrame(parsed)
    }

    ws.onerror = () => {
      // onerror fires before onclose; defer status update to onclose.
    }

    ws.onclose = () => {
      wsRef.current = null
      if (stoppedByUserRef.current) {
        // User-initiated stop: keep the last data on screen, do not retry.
        return
      }
      if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: new DeviceDisconnectedError(),
        }))
        return
      }
      reconnectAttemptsRef.current += 1
      setState((prev) => ({ ...prev, status: 'connecting' }))
      reconnectTimerRef.current = setTimeout(() => {
        connect()
      }, reconnectDelayMs)
    }
  }, [applyFrame, clearReconnect, maxReconnectAttempts, reconnectDelayMs, url])

  const start = useCallback(() => {
    stoppedByUserRef.current = false
    reconnectAttemptsRef.current = 0
    connect()
  }, [connect])

  const stop = useCallback(() => {
    stoppedByUserRef.current = true
    clearReconnect()
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {
        // The socket may already be closing; ignore.
      }
      wsRef.current = null
    }
    // Note: we keep `frozen` true and `data` intact so the user can still
    // generate a report from the last frame.
  }, [clearReconnect])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stoppedByUserRef.current = true
      clearReconnect()
      if (wsRef.current) {
        try {
          wsRef.current.close()
        } catch {
          // ignore
        }
        wsRef.current = null
      }
    }
  }, [clearReconnect])

  return {
    ...state,
    start,
    stop,
    isStreaming: state.status === 'streaming',
    frozen,
  }
}
