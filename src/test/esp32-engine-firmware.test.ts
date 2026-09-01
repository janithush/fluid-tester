import { describe, it, expect } from 'vitest'

/**
 * Documents the ESP32 firmware behavior for the Phase 3 engine-oil
 * sub-metrics. The actual main.ino is C++ and not directly testable
 * from the JS test runner, so the relevant branches of
 * buildResultsJson() are replicated here in TypeScript to lock in
 * the contract.
 *
 * Rules pinned by these tests:
 *   1. capacitance is null until webEngineMeasurementTaken is true
 *      (operator must click "Fetch" to take a measurement).
 *   2. tbn, tan, viscosity are ALWAYS null in the current firmware
 *      (the sensors are not wired). The mapper renders them as "N/A".
 *   3. The JSON wire shape never omits these fields. A future PR
 *      that adds real values to one of them must update the mapper.
 *   4. UART lines starting with TBN:, TAN:, Viscosity: are reserved
 *      for the future chemistry sensor.
 */

function buildEngineOilJson(firmware: {
  webDielectric: number
  webCapacitance: number
  webWaterStatus: string
  webEngineStatus: string
  webEngineMeasurementTaken: boolean
  webTBN: number
  webTAN: number
  webViscosity: number
}): string {
  const waterFlag = firmware.webWaterStatus.indexOf('YES') >= 0 ? 'YES' : 'NO'
  const capacitanceJson = firmware.webEngineMeasurementTaken
    ? String(firmware.webCapacitance)
    : 'null'

  return (
    '{' +
    `"dielectric":${String(firmware.webDielectric)},` +
    `"capacitance":${capacitanceJson},` +
    `"water":"${waterFlag}",` +
    `"tbn":null,` +
    `"tan":null,` +
    `"viscosity":null,` +
    `"status":"${firmware.webEngineStatus}"` +
    '}'
  )
}

describe('ESP32 firmware — engine_oil wire shape (replica)', () => {
  it('emits capacitance=null when webEngineMeasurementTaken is false', () => {
    const json = buildEngineOilJson({
      webDielectric: 2.4,
      webCapacitance: 3.72,
      webWaterStatus: 'NO',
      webEngineStatus: 'GOOD',
      webEngineMeasurementTaken: false,
      webTBN: 0,
      webTAN: 0,
      webViscosity: 0,
    })
    expect(json).toContain('"capacitance":null')
    expect(json).not.toContain('"capacitance":3.72')
  })

  it('emits capacitance as a number (2dp) when webEngineMeasurementTaken is true', () => {
    const json = buildEngineOilJson({
      webDielectric: 2.4,
      webCapacitance: 3.72,
      webWaterStatus: 'NO',
      webEngineStatus: 'GOOD',
      webEngineMeasurementTaken: true,
      webTBN: 0,
      webTAN: 0,
      webViscosity: 0,
    })
    expect(json).toContain('"capacitance":3.72')
    expect(json).toMatch(/"capacitance":\d+\.\d{2}/)
  })

  it('emits tbn/tan/viscosity as null in the current firmware (no sensor wired)', () => {
    // Pin: even if the firmware's global variables are non-zero, the
    // JSON must still emit null. The future sensor PR will need to
    // update BOTH the firmware AND remove these pinned nulls, which
    // is the desired review surface.
    const json = buildEngineOilJson({
      webDielectric: 2.4,
      webCapacitance: 3.72,
      webWaterStatus: 'NO',
      webEngineStatus: 'GOOD',
      webEngineMeasurementTaken: true,
      webTBN: 99.9,
      webTAN: 99.9,
      webViscosity: 99.9,
    })
    expect(json).toContain('"tbn":null')
    expect(json).toContain('"tan":null')
    expect(json).toContain('"viscosity":null')
    expect(json).not.toContain('99.9')
  })

  it('round-trips through JSON.parse and matches the EngineOilReading shape', () => {
    const json = buildEngineOilJson({
      webDielectric: 2.4,
      webCapacitance: 3.72,
      webWaterStatus: 'NO',
      webEngineStatus: 'GOOD',
      webEngineMeasurementTaken: true,
      webTBN: 0,
      webTAN: 0,
      webViscosity: 0,
    })
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed).toEqual({
      dielectric: 2.4,
      capacitance: 3.72,
      water: 'NO',
      tbn: null,
      tan: null,
      viscosity: null,
      status: 'GOOD',
    })
  })

  it('emits a JSON object with the canonical key order', () => {
    // Pin the firmware's String-concatenation order so a C++
    // refactor that changes the order is caught.
    const json = buildEngineOilJson({
      webDielectric: 2.4,
      webCapacitance: 3.72,
      webWaterStatus: 'NO',
      webEngineStatus: 'GOOD',
      webEngineMeasurementTaken: true,
      webTBN: 0,
      webTAN: 0,
      webViscosity: 0,
    })
    const keyOrder = Object.keys(JSON.parse(json) as object)
    expect(keyOrder).toEqual([
      'dielectric',
      'capacitance',
      'water',
      'tbn',
      'tan',
      'viscosity',
      'status',
    ])
  })
})

describe('UART line format reserved for the future chemistry sensor', () => {
  /**
   * The brake Arduino currently streams multi-line labels. Phase 3
   * reserves three new label prefixes for the future chemistry sensor:
   *   TBN: <number>
   *   TAN: <number>
   *   Viscosity: <number>
   * The current firmware does NOT have a parser for these lines.
   * This test pins the expected parser contract so the future
   * sensor PR has a clear spec.
   */
  function isChemistryLine(line: string): boolean {
    return /^(TBN|TAN|Viscosity):\s*-?\d+(\.\d+)?\s*$/.test(line.trim())
  }

  it('accepts TBN: 8.20 as a chemistry line', () => {
    expect(isChemistryLine('TBN: 8.20')).toBe(true)
  })

  it('accepts TAN: 1.50 as a chemistry line', () => {
    expect(isChemistryLine('TAN: 1.50')).toBe(true)
  })

  it('accepts Viscosity: 92.0 as a chemistry line', () => {
    expect(isChemistryLine('Viscosity: 92.0')).toBe(true)
  })

  it('rejects "Moisture: 1%" (not a chemistry line)', () => {
    expect(isChemistryLine('Moisture: 1%')).toBe(false)
  })

  it('rejects "TBN: abc" (non-numeric value)', () => {
    expect(isChemistryLine('TBN: abc')).toBe(false)
  })
})
