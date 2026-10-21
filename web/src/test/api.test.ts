import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchFluidResults, DeviceDisconnectedError } from '@/lib/api'

describe('fetchFluidResults', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed JSON on a successful response', async () => {
    const data = {
      brake_oil: { moisture: '2%', status: 'GOOD' },
      engine_oil: { dielectric: 2.1, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7, status: 'GOOD' }, }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(data) }),
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
        json: () => Promise.resolve({}) }),
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
        json: () => Promise.reject(new SyntaxError('Unexpected token')) }),
    )

    await expect(fetchFluidResults()).rejects.toBeInstanceOf(
      DeviceDisconnectedError,
    )
  })

  it('derives the default endpoint from window.location (R4)', async () => {
    // The dashboard is served by the ESP32 itself, so the default
    // endpoint must target the page origin - whatever the operator
    // used to reach the device (mDNS name, softAP IP, LAN alias).
    const expectedUrl = `${window.location.protocol}//${window.location.host}/api/data`
    // Mock a response-like object that satisfies the API's contract
    // without depending on jsdom's Response.json() implementation.
    const fakeResponse = {
      ok: true,
      status: 200,
      json: () => Promise.resolve({}) }
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse)
    vi.stubGlobal('fetch', fetchMock)

    await fetchFluidResults()
    expect(fetchMock).toHaveBeenCalledWith(
      expectedUrl,
      expect.objectContaining({ method: 'GET' }),
    )

    // Explicit parameter overrides always win.
    await fetchFluidResults('http://custom.local/api/x')
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://custom.local/api/x',
      expect.anything(),
    )
  })

  it('applies a default 5s abort timeout when no signal is passed (R16)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    await fetchFluidResults()
    const call = fetchMock.mock.calls[0][1] as { signal?: AbortSignal }
    if (typeof AbortSignal.timeout === 'function') {
      expect(call.signal).toBeInstanceOf(AbortSignal)
    }
    // Explicit signals pass through untouched.
    const controller = new AbortController()
    await fetchFluidResults('http://custom.local/api/x', controller.signal)
    const second = fetchMock.mock.calls[1][1] as { signal?: AbortSignal }
    expect(second.signal).toBe(controller.signal)
  })
})
