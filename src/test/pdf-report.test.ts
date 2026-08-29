import { describe, it, expect } from 'vitest'
import { canGenerateReport } from '@/lib/pdf-report'
import type { FluidCardModel, VehicleForm } from '@/types/fluid'

const baseForm: VehicleForm = {
  date: '2026-08-29',
  vehicleNumber: 'ABC123',
  kmUsage: 45000,
}

const goodBrake: FluidCardModel = {
  kind: 'brake_oil',
  title: 'Brake Oil',
  icon: '🛢️',
  primaryMetric: '2% moisture',
  secondaryMetrics: [],
  status: 'GOOD',
  hasError: false,
}

const errorFluid: FluidCardModel = {
  kind: 'brake_oil',
  title: 'Brake Oil',
  icon: '🛢️',
  primaryMetric: 'N/A',
  secondaryMetrics: [],
  status: 'ERROR',
  hasError: true,
}

describe('canGenerateReport (PDF trigger logic)', () => {
  it('is true with valid form + at least one good result', () => {
    expect(canGenerateReport(baseForm, [goodBrake])).toBe(true)
  })

  it('is false when results are null', () => {
    expect(canGenerateReport(baseForm, null)).toBe(false)
  })

  it('is false when results are empty', () => {
    expect(canGenerateReport(baseForm, [])).toBe(false)
  })

  it('is false when every fluid errored', () => {
    expect(canGenerateReport(baseForm, [errorFluid, errorFluid, errorFluid])).toBe(
      false,
    )
  })

  it('is false when form is invalid (missing date)', () => {
    expect(
      canGenerateReport({ ...baseForm, date: '' }, [goodBrake]),
    ).toBe(false)
  })

  it('is false when form is invalid (zero km)', () => {
    expect(canGenerateReport({ ...baseForm, kmUsage: 0 }, [goodBrake])).toBe(
      false,
    )
  })

  it('is false when form is invalid (empty vehicle number)', () => {
    expect(
      canGenerateReport({ ...baseForm, vehicleNumber: '' }, [goodBrake]),
    ).toBe(false)
  })

  it('is true if at least one fluid is good (mixed results)', () => {
    const mixed = [goodBrake, errorFluid, errorFluid]
    expect(canGenerateReport(baseForm, mixed)).toBe(true)
  })
})
