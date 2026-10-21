import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VehicleFormCard } from '@/components/vehicle-form'
import type { VehicleForm } from '@/types/fluid'

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-29T10:00:00Z'))
})
afterAll(() => {
  vi.useRealTimers()
})

describe('<VehicleFormCard />', () => {
  it('auto-fills the date field with today on mount', () => {
    const value: VehicleForm = { date: '', vehicleNumber: '', kmUsage: 0 }
    render(<VehicleFormCard value={value} onChange={() => {}} />)
    const dateInput = screen.getByTestId('input-date') as HTMLInputElement
    expect(dateInput.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('lets the user change the date after auto-fill', () => {
    const value: VehicleForm = { date: '', vehicleNumber: '', kmUsage: 0 }
    const onChange = vi.fn()
    render(<VehicleFormCard value={value} onChange={onChange} />)

    const dateInput = screen.getByTestId('input-date') as HTMLInputElement
    fireEvent.change(dateInput, { target: { value: '2026-12-31' } })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-12-31' }),
    )
  })

  it('does NOT show errors on initial mount even when fields are invalid', () => {
    // Per the futuristic UX spec: errors should only appear after the
    // user has interacted with a field (touched). On first mount, no
    // errors are visible.
    const value: VehicleForm = { date: '', vehicleNumber: '', kmUsage: 0 }
    render(<VehicleFormCard value={value} onChange={() => {}} />)
    expect(screen.queryByTestId('error-date')).toBeNull()
    expect(screen.queryByTestId('error-vehicle')).toBeNull()
    expect(screen.queryByTestId('error-km')).toBeNull()
  })

  it('shows an error after the user types an invalid vehicle number', () => {
    const value: VehicleForm = { date: '2026-08-29', vehicleNumber: '', kmUsage: 100 }
    render(<VehicleFormCard value={value} onChange={() => {}} />)

    // Initially no error
    expect(screen.queryByTestId('error-vehicle')).toBeNull()

    // After typing an invalid value, the error appears
    const vehicleInput = screen.getByTestId('input-vehicle')
    fireEvent.change(vehicleInput, { target: { value: 'AB-12' } })
    expect(screen.getByTestId('error-vehicle')).toBeInTheDocument()
  })

  it('shows an error after blur on an invalid vehicle number (no typing)', () => {
    const value: VehicleForm = { date: '2026-08-29', vehicleNumber: 'AB-12', kmUsage: 100 }
    render(<VehicleFormCard value={value} onChange={() => {}} />)

    // Initially no error (untouched)
    expect(screen.queryByTestId('error-vehicle')).toBeNull()

    // After focus + blur, the error appears
    const vehicleInput = screen.getByTestId('input-vehicle')
    fireEvent.focus(vehicleInput)
    fireEvent.blur(vehicleInput)
    expect(screen.getByTestId('error-vehicle')).toBeInTheDocument()
  })

  it('shows no errors when all fields are valid', () => {
    const value: VehicleForm = { date: '2026-08-29', vehicleNumber: 'ABC123', kmUsage: 100 }
    render(<VehicleFormCard value={value} onChange={() => {}} />)
    expect(screen.queryByTestId('error-date')).toBeNull()
    expect(screen.queryByTestId('error-vehicle')).toBeNull()
    expect(screen.queryByTestId('error-km')).toBeNull()
  })
})
