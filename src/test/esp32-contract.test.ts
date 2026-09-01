import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchFluidResults, DeviceDisconnectedError } from '@/lib/api'
import { mapAllResults } from '@/lib/results-mapper'

/**
 * Contract test: the JSON shape produced by the ESP32 firmware's
 * `buildResultsJson()` must round-trip cleanly through `mapAllResults()`
 * without any card being flagged `hasError: true`.
 *
 * If this test ever fails, the frontend will show "Signal Lost" cards
 * (the bug we just fixed).  The test catches regressions in either side
 * of the contract.
 */
describe('ESP32 JSON contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('default endpoint is /api/data (matches ESP32 server.on registration)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    await fetchFluidResults()
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toMatch(/\/api\/data$/)
    expect(calledUrl).not.toMatch(/\/api\/results/)
  })

  it('ESP32 nested JSON shape round-trips with no hasError flags', async () => {
    // This is a representative payload of what main.ino's
    // buildResultsJson() produces during a normal engine-oil run.
    const esp32Payload = {
      brake_oil: { moisture: '2%', status: 'GOOD' },
      engine_oil: { dielectric: 2.15, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7.5, status: 'UNKNOWN' }, }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(esp32Payload) }),
    )

    const data = await fetchFluidResults()
    const cards = mapAllResults(data)

    expect(cards).toHaveLength(3)
    expect(cards.every((c) => !c.hasError)).toBe(true)
    expect(cards[0].status).toBe('GOOD')
    expect(cards[1].status).toBe('GOOD')
    expect(cards[2].status).toBe('UNKNOWN')
  })

  it('ESP32 critical readings survive the strict-status mapper', async () => {
    const esp32Payload = {
      brake_oil: { moisture: '5%', status: 'CRITICAL' },
      engine_oil: { dielectric: 2.9, water: 'YES', status: 'CRITICAL', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 5.0, status: 'CRITICAL' }, }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(esp32Payload) }),
    )

    const cards = mapAllResults(await fetchFluidResults())
    expect(cards.every((c) => c.status === 'CRITICAL')).toBe(true)
    expect(cards.every((c) => !c.hasError)).toBe(true)
  })

  it('ESP32 unmapped status string (e.g. EXCELLENT) maps to UNKNOWN, not ERROR', async () => {
    // The ESP32 LCD uses human strings like EXCELLENT / GOOD/SVC DUE
    // / WATER DETECT that are NOT in the frontend's closed enum.
    // The mapper must degrade these to UNKNOWN (gray pill) without
    // flipping hasError=true (which would show the broken "Signal Lost"
    // card instead).
    const esp32Payload = {
      brake_oil: { moisture: '0.5%', status: 'EXCELLENT' },
      engine_oil: { dielectric: 2.10, water: 'NO', status: 'GOOD/SVC DUE', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7.0, status: 'UNKNOWN' }, }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(esp32Payload) }),
    )

    const cards = mapAllResults(await fetchFluidResults())
    expect(cards[0].status).toBe('UNKNOWN')
    expect(cards[0].hasError).toBe(false)
    expect(cards[1].status).toBe('UNKNOWN')
    expect(cards[1].hasError).toBe(false)
    expect(cards[2].status).toBe('UNKNOWN')
    expect(cards[2].hasError).toBe(false)
  })

  it('ESP32 N/A status string is preserved as a string but mapped to UNKNOWN', async () => {
    const esp32Payload = {
      brake_oil: { moisture: 'N/A', status: 'N/A' },
      engine_oil: { dielectric: 0, water: 'NO', status: 'N/A', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7.0, status: '' }, }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(esp32Payload) }),
    )

    const cards = mapAllResults(await fetchFluidResults())
    // `brake_oil` and `engine_oil` carry meaningful fields (moisture
    // "N/A" is a string, dielectric 0 is a number) so they should NOT
    // trigger the "missing required field" hasError branch.
    expect(cards[0].hasError).toBe(false)
    expect(cards[1].hasError).toBe(false)
    expect(cards[2].hasError).toBe(false)
    expect(cards[0].status).toBe('UNKNOWN')
    expect(cards[1].status).toBe('UNKNOWN')
    expect(cards[2].status).toBe('UNKNOWN')
  })

  it('DeviceDisconnectedError is still thrown on 404 (the original URL bug symptom)', async () => {
    // Before the fix, the ESP32 returned 404 for /api/results. We must
    // keep throwing DeviceDisconnectedError so the UI shows the right
    // toast even if the operator ever types the wrong URL.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.reject(new SyntaxError('not json')) }),
    )
    await expect(fetchFluidResults()).rejects.toBeInstanceOf(DeviceDisconnectedError)
  })

  it('Universal NO_DATA shape: when no UART has arrived, brake is noData (not UNKNOWN)', async () => {
    // This is the contract the new main.ino must produce before any
    // brake Arduino UART line has arrived. The card should render
    // "No measurement yet" with a NO_DATA pill — not the broken
    // "Status: NORMAL" text that was leaking through before.
    const esp32Payload = {
      brake_oil: { moisture: null, status: 'NO_DATA' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7.0, status: 'NO_DATA' }, }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(esp32Payload) }),
    )

    const cards = mapAllResults(await fetchFluidResults())
    expect(cards[0].noData).toBe(true)
    expect(cards[0].hasError).toBe(false)
    expect(cards[0].status).toBe('NO_DATA')
    expect(cards[0].primaryMetric).toBe('No measurement yet')
    // The literal text "Status: NORMAL" must NOT leak into the UI.
    expect(cards[0].primaryMetric).not.toMatch(/Status:/)
  })

  it('Brake parser regression guard: status "NORMAL" appears once, not duplicated in metric', async () => {
    // The previous bug was that the firmware's else-branch in
    // displayBrakeData() set webBrakeStatus = data (the entire UART
    // line), so the JSON contained "status":"Moisture: 1% | Status: NORMAL".
    // The mapper then rendered that as the primary metric. With the
    // parser fix, only the parsed status reaches the wire.
    const esp32Payload = {
      brake_oil: { moisture: '1%', status: 'NORMAL' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: 7.0, status: 'GOOD' }, }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(esp32Payload) }),
    )

    const cards = mapAllResults(await fetchFluidResults())
    expect(cards[0].status).toBe('NORMAL')
    expect(cards[0].noData).toBe(false)
    expect(cards[0].hasError).toBe(false)
    expect(cards[0].primaryMetric).toBe('1% moisture')
    expect(cards[0].primaryMetric).not.toMatch(/Status:/)
  })

  it('Coolant noData: when sensor is absent, card shows noData and "No measurement yet"', async () => {
    // Before the fix, main.ino hard-coded `"ph":7.0,"status":"UNKNOWN"`
    // for coolant regardless of whether a sensor was wired up. The new
    // firmware must send null + NO_DATA so the card doesn't lie about
    // a measurement.
    const esp32Payload = {
      brake_oil: { moisture: '1%', status: 'NORMAL' },
      engine_oil: { dielectric: 2.4, water: 'NO', status: 'GOOD', capacitance: null, tbn: null, tan: null, viscosity: null},
      coolant: { ph: null, status: 'NO_DATA' }, }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(esp32Payload) }),
    )

    const cards = mapAllResults(await fetchFluidResults())
    expect(cards[2].noData).toBe(true)
    expect(cards[2].hasError).toBe(false)
    expect(cards[2].status).toBe('NO_DATA')
    expect(cards[2].primaryMetric).toBe('No measurement yet')
  })
})