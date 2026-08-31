import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchFluidResults, DeviceDisconnectedError } from '@/lib/api'

describe('fetchFluidResults', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed JSON on a successful response', async () => {
    const data = {
      brake_oil: { moisture: '2%', status: 'GOOD' },
      engine_oil: { dielectric: 2.1, water: 'NO', status: 'GOOD' },
      coolant: { ph: 7, status: 'GOOD' },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data),
      }),
    )

    const result = await fetchFluidResults()
    expect(result.brake_oil.status).toBe('GOOD')
    expect(result.coolant.ph).toBe(7)
  })

  it('throws DeviceDisconnectedError on network failure (device offline)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )

    await expect(fetchFluidResults()).rejects.toBeInstanceOf(
      DeviceDisconnectedError,
    )
  })

  it('throws DeviceDisconnectedError on non-2xx HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }),
    )

    await expect(fetchFluidResults()).rejects.toBeInstanceOf(
      DeviceDisconnectedError,
    )
  })

  it('throws DeviceDisconnectedError on invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }),
    )

    await expect(fetchFluidResults()).rejects.toBeInstanceOf(
      DeviceDisconnectedError,
    )
  })

  it('uses the default mDNS endpoint unless overridden', async () => {
    // Mock a response-like object that satisfies the API's contract
    // without depending on jsdom's Response.json() implementation.
    const fakeResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    }
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse)
    vi.stubGlobal('fetch', fetchMock)

    await fetchFluidResults()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://fluidtester.local/api/data',
      expect.objectContaining({ method: 'GET' }),
    )

    await fetchFluidResults('http://custom.local/api/x')
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://custom.local/api/x',
      expect.anything(),
    )
  })
})
