import type { FormErrors, VehicleForm } from '@/types/fluid'

// Tier 1: real workshop plates carry hyphens and spaces ("WP-CAB-1234",
// "CAB 1234"). Accept 3-15 chars of letters, digits, hyphens and spaces.
// Length guards keep the PDF filename sane.
export const VEHICLE_NUMBER_REGEX = /^[A-Za-z0-9 -]{3,15}$/
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

/**
 * Returns today's date in YYYY-MM-DD format using the local timezone.
 * Pure function (deterministic per call) — but we isolate it so it can be
 * mocked in tests if needed.
 */
export function todayIsoDate(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Validates a form and returns a partial errors object. An empty object
 * means the form is valid. All fields are required.
 */
export function validateForm(form: VehicleForm): FormErrors {
  const errors: FormErrors = {}

  if (!form.date || !ISO_DATE_REGEX.test(form.date)) {
    errors.date = 'Date is required (YYYY-MM-DD).'
  }

  if (!form.vehicleNumber || !form.vehicleNumber.trim()) {
    errors.vehicleNumber = 'Vehicle number is required.'
  } else if (!VEHICLE_NUMBER_REGEX.test(form.vehicleNumber.trim())) {
    errors.vehicleNumber =
      'Vehicle number must be alphanumeric (3-15 letters, numbers, hyphens or spaces).'
  }

  const km = Number(form.kmUsage)
  if (
    form.kmUsage === undefined ||
    form.kmUsage === null ||
    Number.isNaN(km) ||
    km <= 0
  ) {
    errors.kmUsage = 'Km usage must be a positive number.'
  }

  return errors
}

export function isFormValid(form: VehicleForm): boolean {
  return Object.keys(validateForm(form)).length === 0
}
