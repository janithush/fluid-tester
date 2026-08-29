import type { FluidResultsResponse } from '@/types/fluid'

export class DeviceDisconnectedError extends Error {
  constructor(message = 'Device Disconnected. Please check connection.') {
    super(message)
    this.name = 'DeviceDisconnectedError'
  }
}

/**
 * Fetches the latest fluid results from the ESP32's HTTP endpoint.
 * The endpoint URL defaults to the mDNS host configured in Phase 1.
 */
export async function fetchFluidResults(
  endpoint = 'http://fluidtester.local/api/results',
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
