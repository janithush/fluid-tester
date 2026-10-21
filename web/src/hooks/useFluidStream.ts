import { useCallback, useEffect, useRef, useState } from 'react'
import { DeviceDisconnectedError } from '@/lib/api'
import type {
  FluidResultsResponse,
  WsFrame,
} from '@/types/fluid'

/**
 * R4: the WebSocket endpoint is derived from the page origin by default
 * (the ESP32 serves this app itself over softAP/mDNS), so the dashboard
 * works no matter how the operator reached the device - via
 * `fluidtester.local`, the softAP IP (192.168.4.1), or a LAN alias.
 */
const defaultWsUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
    : 'ws://192.168.4.1/ws'

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
  /**
   * R3: true when the socket is still technically open but no frame
   * (snapshot, delta, or heartbeat) has arrived for longer than
   * `staleThresholdMs`. The UI must show a distinct "Signal Stale"
   * state instead of a frozen "Signal Live".
   */
  isStale: boolean
}

export interface UseFluidStreamOptions {
  /** ws:// or wss:// endpoint. Default derives from window.location. */
  url?: string
  /** Base reconnect delay (ms) on unexpected close. Default 1500. */
  reconnectDelayMs?: number
  /** Max consecutive reconnect attempts before giving up. Default 8. */
  maxReconnectAttempts?: number
  /** Upper bound for the exponential backoff delay. Default 10000. */
  maxBackoffMs?: number
  /** Silence window (ms) after which the stream is flagged stale. Default 15000. */
  staleThresholdMs?: number
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
 * - Errors and unexpected closes trigger a reconnect loop with
 *   exponential backoff + jitter (R13). After `maxReconnectAttempts`
 *   consecutive failures, status becomes 'error' and the last error is
 *   exposed.
 * - Every incoming frame (including heartbeats) refreshes the activity
 *   timestamp; a `staleThresholdMs` silence while connected flags the
 *   stream stale (R3).
 * - The hook is safe to use in React 18 StrictMode (the cleanup callback
 *   tears down the socket and both timers).
 */
export function useFluidStream(
  options: UseFluidStreamOptions = {},
): UseFluidStreamApi {
  const {
    url = defaultWsUrl,
    reconnectDelayMs = 1500,
    maxReconnectAttempts = 8,
    maxBackoffMs = 10_000,
    staleThresholdMs = 15_000,
    onFrame,
  } = options

  const [state, setState] = useState<UseFluidStreamState>({
    status: 'idle',
    data: null,
    error: null,
    lastUpdateMs: null,
    isStale: false,
  })

  // `frozen` is true the moment a snapshot frame has been received. It
  // remains true even after stop() (so the report button stays enabled).
  const [frozen, setFrozen] = useState(false)

  // Refs to the live WebSocket, reconnect timer, and staleness timer.
  // They survive renders and let the cleanup callback reach the current
  // instance.
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastActivityTsRef = useRef<number | null>(null)
  const stoppedByUserRef = useRef(false)
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  // The "apply a frame" function is stable across renders.
  const applyFrame = useCallback((frame: WsFrame) => {
    // R3: every frame - including heartbeats - proves the link is alive.
    lastActivityTsRef.current = Date.now()
    if (frame.kind === 'heartbeat') {
      setState((prev) => (prev.isStale ? { ...prev, isStale: false } : prev))
      return
    }
    onFrameRef.current?.(frame)
    setFrozen(true)
    setState((prev) => {
      const ts = Date.now()
      switch (frame.kind) {
        case 'snapshot':
          return { status: 'streaming', data: frame.data, error: null, lastUpdateMs: ts, isStale: false }
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
          return { ...prev, data: next, lastUpdateMs: ts, isStale: false }
        }
        case 'engine_oil': {
          const next: FluidResultsResponse = {
            brake_oil: prev.data?.brake_oil ?? { moisture: null, status: 'NO_DATA' },
            engine_oil: frame.data,
            coolant: prev.data?.coolant ?? { ph: null, status: 'NO_DATA' },
          }
          return { ...prev, data: next, lastUpdateMs: ts, isStale: false }
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
          return { ...prev, data: next, lastUpdateMs: ts, isStale: false }
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

  const clearStaleTimer = useCallback(() => {
    if (staleTimerRef.current) {
      clearInterval(staleTimerRef.current)
      staleTimerRef.current = null
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

    setState((prev) => ({ ...prev, status: 'connecting', error: null, isStale: false }))

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
      // R3: the open event starts the activity clock; the watchdog
      // interval only runs while a socket is live.
      lastActivityTsRef.current = Date.now()
      clearStaleTimer()
      staleTimerRef.current = setInterval(() => {
        const last = lastActivityTsRef.current
        const stale =
          last !== null && Date.now() - last > staleThresholdMs
        setState((prev) => (prev.isStale === stale ? prev : { ...prev, isStale: stale }))
      }, 1000)
      setState((prev) => ({ ...prev, status: 'streaming', error: null, isStale: false }))
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
      clearStaleTimer()
      wsRef.current = null
      if (stoppedByUserRef.current) {
        // User-initiated stop: keep the last data on screen, do not retry.
        return
      }
      const attempt = reconnectAttemptsRef.current
      if (attempt >= maxReconnectAttempts) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          isStale: false,
          error: new DeviceDisconnectedError(),
        }))
        return
      }
      // R13: exponential backoff with jitter. Delay doubles per failed
      // attempt (base = reconnectDelayMs), capped at maxBackoffMs, with
      // up to +30% jitter so multiple tabs do not retry in lockstep.
      reconnectAttemptsRef.current = attempt + 1
      const backoff = Math.min(reconnectDelayMs * Math.pow(2, attempt), maxBackoffMs)
      const delay = backoff + Math.random() * 0.3 * backoff
      setState((prev) => ({ ...prev, status: 'connecting', isStale: false }))
      reconnectTimerRef.current = setTimeout(() => {
        connect()
      }, delay)
    }
  }, [
    applyFrame,
    clearReconnect,
    clearStaleTimer,
    maxBackoffMs,
    maxReconnectAttempts,
    reconnectDelayMs,
    staleThresholdMs,
    url,
  ])

  const start = useCallback(() => {
    stoppedByUserRef.current = false
    reconnectAttemptsRef.current = 0
    connect()
  }, [connect])

  const stop = useCallback(() => {
    stoppedByUserRef.current = true
    clearReconnect()
    clearStaleTimer()
    // Fix: a user stop must land the state machine back on 'idle' so
    // the operator can resume without a page reload. Previously the
    // status stayed 'streaming', which left the UI wedged on the
    // disabled live-reading pill with no way to restart the stream.
    setState((prev) =>
      prev.status === 'idle' && !prev.isStale
        ? prev
        : { ...prev, status: 'idle', isStale: false },
    )
    if (wsRef.current) {
      try {
        wsRef.current.close()
      } catch {
        // The socket may already be closing; ignore.
      }
      wsRef.current = null
    }
    // Note: we keep `frozen` true and `data` intact so the user can still
    // generate a report from the last frame - and the UI can offer a
    // "Resume Reading" action from the same session.
  }, [clearReconnect, clearStaleTimer])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      stoppedByUserRef.current = true
      clearReconnect()
      clearStaleTimer()
      if (wsRef.current) {
        try {
          wsRef.current.close()
        } catch {
          // ignore
        }
        wsRef.current = null
      }
    }
  }, [clearReconnect, clearStaleTimer])

  return {
    ...state,
    start,
    stop,
    isStreaming: state.status === 'streaming',
    frozen,
  }
}
