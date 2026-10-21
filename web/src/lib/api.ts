import type { FluidResultsResponse } from '@/types/fluid'

/**
 * R4: the HTTP endpoint is derived from the page origin by default (the
 * ESP32 serves this app itself over softAP/mDNS), so it works via
 * `fluidtester.local`, the softAP IP (192.168.4.1), or a LAN alias.
 */
const defaultApiUrl =
  typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}/api/data`
    : 'http://192.168.4.1/api/data'

export class DeviceDisconnectedError extends Error {
  constructor(message = 'Device Disconnected. Please check connection.') {
    super(message)
    this.name = 'DeviceDisconnectedError'
  }
}

/**
 * Fetches the latest fluid results from the ESP32's HTTP endpoint.
 *
 * The ESP32 firmware exposes a single endpoint at `/api/data` and emits a
 * nested JSON object that matches `FluidResultsResponse`. We hit that
 * endpoint here (it was previously `/api/results`, which the ESP32 never
 * served and caused every "Fetch Latest Reading" click to 404).
 *
 * R16: a 5 s abort timeout is applied by default so a device that accepts
 * the TCP connection but never answers cannot hang the caller forever.
 */
export async function fetchFluidResults(
  endpoint: string = defaultApiUrl,
  signal?: AbortSignal,
): Promise<FluidResultsResponse> {
  // Guarded: AbortSignal.timeout is unavailable in some older/jsdom runtimes.
  const effectiveSignal =
    signal ??
    (typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(5000)
      : undefined)

  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: effectiveSignal,
    })
  } catch {
    // Network failure, DNS failure, device offline, CORS denial, timeout.
    throw new DeviceDisconnectedError()
  }

  if (!res.ok) {
    throw new DeviceDisconnectedError(
      `Device returned HTTP ${res.status}. Please check connection.`,
    )
  }

  try {
    const data = (await res.json()) as FluidResultsResponse
    return data
  } catch {
    throw new DeviceDisconnectedError(
      'Device returned an invalid response. Please check connection.',
    )
  }
}
