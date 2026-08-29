import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import {
  isFormValid,
  todayIsoDate,
  validateForm,
} from '@/lib/form-validation'
import type { VehicleForm } from '@/types/fluid'

describe('todayIsoDate', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-29T10:00:00Z'))
  })
  afterAll(() => {
    vi.useRealTimers()
  })

  it('returns a YYYY-MM-DD string for today', () => {
    const today = todayIsoDate()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

const baseValid: VehicleForm = {
  date: '2026-08-29',
  vehicleNumber: 'ABC123',
  kmUsage: 45000,
}

describe('validateForm', () => {
  it('returns no errors for a fully valid form', () => {
    expect(validateForm(baseValid)).toEqual({})
  })

  it('rejects missing date', () => {
    const errs = validateForm({ ...baseValid, date: '' })
    expect(errs.date).toBeDefined()
  })

  it('rejects malformed date', () => {
    const errs = validateForm({ ...baseValid, date: 'not-a-date' })
    expect(errs.date).toBeDefined()
  })

  it('rejects missing vehicle number', () => {
    const errs = validateForm({ ...baseValid, vehicleNumber: '' })
    expect(errs.vehicleNumber).toBeDefined()
  })

  it('rejects vehicle number with non-alphanumeric characters', () => {
    const errs = validateForm({ ...baseValid, vehicleNumber: 'AB-123' })
    expect(errs.vehicleNumber).toMatch(/alphanumeric/i)
  })

  it('accepts alphanumeric vehicle numbers of any case', () => {
    expect(validateForm({ ...baseValid, vehicleNumber: 'xyz789' })).toEqual({})
    expect(validateForm({ ...baseValid, vehicleNumber: 'X1Y2Z3' })).toEqual({})
  })

  it('rejects zero or negative km', () => {
    expect(validateForm({ ...baseValid, kmUsage: 0 }).kmUsage).toBeDefined()
    expect(validateForm({ ...baseValid, kmUsage: -5 }).kmUsage).toBeDefined()
  })

  it('rejects NaN km', () => {
    expect(validateForm({ ...baseValid, kmUsage: Number.NaN }).kmUsage).toBeDefined()
  })
})

describe('isFormValid', () => {
  it('returns true for valid form', () => {
    expect(isFormValid(baseValid)).toBe(true)
  })
  it('returns false when any field is missing', () => {
    expect(isFormValid({ ...baseValid, vehicleNumber: '' })).toBe(false)
  })
})
