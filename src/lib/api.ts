import type { FluidResultsResponse } from '@/types/fluid'

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
 */
export async function fetchFluidResults(
  endpoint = 'http://fluidtester.local/api/data',
  signal?: AbortSignal,
): Promise<FluidResultsResponse> {
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch {
    // Network failure, DNS failure, device offline, etc.
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
