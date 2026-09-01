import { describe, it, expect } from 'vitest'
import { formatMetricForPdf } from '@/lib/pdf-report'
import type { FluidCardModel } from '@/types/fluid'

/**
 * Engine-oil specific PDF formatting. The Reading cell for the engine row
 * is a multi-line cell containing the primary metric + all 5 sub-metrics.
 * The "Status" column is unaffected by this change.
 */

const baseEngine: FluidCardModel = {
  kind: 'engine_oil',
  title: 'Engine Oil',
  icon: '⚙️',
  primaryMetric: 'Dielectric 2.40',
  secondaryMetrics: [
    'Capacitance: 3.72 pF',
    'Water: NO',
    'TBN: 8.20 mg KOH/g',
    'TAN: 1.50 mg KOH/g',
    'Viscosity: 92.00%',
  ],
  status: 'GOOD',
  hasError: false,
  noData: false,
}

const baseBrake: FluidCardModel = {
  kind: 'brake_oil',
  title: 'Brake Oil',
  icon: '🛢️',
  primaryMetric: '1% moisture',
  secondaryMetrics: [],
  status: 'NORMAL',
  hasError: false,
  noData: false,
}

describe('formatMetricForPdf — engine oil multi-line cell', () => {
  it('renders primary + all 5 sub-metrics separated by newlines', () => {
    const out = formatMetricForPdf(baseEngine)
    expect(out).toBe(
      [
        'Dielectric 2.40',
        'Capacitance: 3.72 pF',
        'Water: NO',
        'TBN: 8.20 mg KOH/g',
        'TAN: 1.50 mg KOH/g',
        'Viscosity: 92.00%',
      ].join('\n'),
    )
  })

  it('renders chemistry "N/A" lines when sensors are absent', () => {
    const m: FluidCardModel = {
      ...baseEngine,
      secondaryMetrics: [
        'Capacitance: 3.72 pF',
        'Water: NO',
        'TBN: N/A',
        'TAN: N/A',
        'Viscosity: N/A',
      ],
    }
    const out = formatMetricForPdf(m)
    expect(out).toBe(
      [
        'Dielectric 2.40',
        'Capacitance: 3.72 pF',
        'Water: NO',
        'TBN: N/A',
        'TAN: N/A',
        'Viscosity: N/A',
      ].join('\n'),
    )
  })

  it('renders "No measurement" (single line) when the card is noData', () => {
    const m: FluidCardModel = {
      ...baseEngine,
      primaryMetric: 'No measurement yet',
      secondaryMetrics: [], // noData cards hide sub-metrics
      status: 'NO_DATA',
      noData: true,
    }
    expect(formatMetricForPdf(m)).toBe('No measurement')
  })

  it('renders "N/A" when the card hasError', () => {
    const m: FluidCardModel = {
      ...baseEngine,
      primaryMetric: 'N/A',
      secondaryMetrics: [],
      status: 'ERROR',
      hasError: true,
    }
    expect(formatMetricForPdf(m)).toBe('N/A')
  })

  it('does NOT apply multi-line treatment to brake oil (single-line only)', () => {
    const m: FluidCardModel = { ...baseBrake, secondaryMetrics: ['Water: NO'] }
    // Brake must NOT have newlines; it stays a single-line cell.
    const out = formatMetricForPdf(m)
    expect(out).not.toMatch(/\n/)
    expect(out).toBe('1% moisture')
  })

  it('does NOT apply multi-line treatment to coolant (single-line only)', () => {
    const m: FluidCardModel = {
      kind: 'coolant',
      title: 'Coolant',
      icon: '❄️',
      primaryMetric: 'pH 7.50',
      secondaryMetrics: [],
      status: 'GOOD',
      hasError: false,
      noData: false,
    }
    const out = formatMetricForPdf(m)
    expect(out).not.toMatch(/\n/)
    expect(out).toBe('pH 7.50')
  })
})

describe('Engine row reading cell — autoTable cell styles', () => {
  /**
   * The PDF generator inspects the title cell of each row in
   * `didParseCell` to decide whether to shrink the engine row's font
   * (8pt instead of 11pt) so all 6 lines fit in the 180pt column.
   * We can't render a real PDF in unit tests, so we replicate the
   * decision function below and assert it triggers correctly.
   */
  function pickCellStyle(title: string, readingRaw: string) {
    const isEngineRow = title === 'Engine Oil'
    const isMultiLine = readingRaw.includes('\n')
    return {
      fontSize: isEngineRow && isMultiLine ? 8 : 11,
      cellPadding: isEngineRow && isMultiLine ? 4 : 8,
    }
  }

  it('shrinks the engine row to 8pt / 4pt padding', () => {
    const style = pickCellStyle('Engine Oil', 'Dielectric 2.40\nCapacitance: 3.72 pF')
    expect(style.fontSize).toBe(8)
    expect(style.cellPadding).toBe(4)
  })

  it('keeps the brake row at 11pt / 8pt padding (no shrink)', () => {
    const style = pickCellStyle('Brake Oil', '1% moisture')
    expect(style.fontSize).toBe(11)
    expect(style.cellPadding).toBe(8)
  })

  it('keeps the coolant row at 11pt / 8pt padding (no shrink)', () => {
    const style = pickCellStyle('Coolant', 'pH 7.50')
    expect(style.fontSize).toBe(11)
    expect(style.cellPadding).toBe(8)
  })
})
