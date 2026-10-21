import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { todayIsoDate, validateForm } from '@/lib/form-validation'
import { cn } from '@/lib/utils'
import type { FormErrors, VehicleForm } from '@/types/fluid'

interface VehicleFormProps {
  value: VehicleForm
  onChange: (form: VehicleForm) => void
  onValidationChange?: (errors: FormErrors) => void
}

type FieldKey = 'date' | 'vehicleNumber' | 'kmUsage'

const TOUCHED_INITIAL: Record<FieldKey, boolean> = {
  date: false,
  vehicleNumber: false,
  kmUsage: false,
}

export function VehicleFormCard({ value, onChange, onValidationChange }: VehicleFormProps) {
  const [touched, setTouched] = useState<Record<FieldKey, boolean>>(TOUCHED_INITIAL)

  // Auto-fill today's date on mount only (per Phase 1 spec).
  useEffect(() => {
    if (!value.date) {
      onChange({ ...value, date: todayIsoDate() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Memoized so `errors` keeps a stable identity across parent
  // re-renders. Previously `validateForm` ran inline on every render,
  // producing a fresh object each time and driving the
  // `onValidationChange` effect into an infinite render loop
  // (parent state update -> re-render -> new errors object -> effect
  // -> parent state update ... => "Maximum update depth exceeded").
  const errors = useMemo(
    () => validateForm({ ...value, date: value.date || todayIsoDate() }),
    // Deliberately narrow deps: memoizing on the whole `value` object would
    // recreate `errors` on every parent re-render and resurrect the loop.
    // The three fields below are the complete validation surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value.date, value.vehicleNumber, value.kmUsage],
  )

  useEffect(() => {
    onValidationChange?.(errors)
  }, [errors, onValidationChange])

  const markTouched = (field: FieldKey) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }))

  const showError = (field: FieldKey) => touched[field] && Boolean(errors[field])

  // For first-paint correctness: show today's date in the input immediately
  // even before the useEffect propagates it to the parent.
  const displayDate = value.date || todayIsoDate()

  return (
    <Card className="glass rounded-2xl" data-testid="vehicle-form">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <span
            className="inline-block h-2 w-2 rounded-full bg-cyan-400 glow-cyan"
            aria-hidden="true"
          />
          Vehicle Information
        </CardTitle>
        <p className="text-xs text-white/40 mt-1">
          Enter details to generate the diagnostic report.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="date" className="text-white/70 text-xs uppercase tracking-wider">
            Date
          </Label>
          <input
            id="date"
            type="date"
            value={displayDate}
            onChange={(e) => {
              onChange({ ...value, date: e.target.value })
              markTouched('date')
            }}
            onBlur={() => markTouched('date')}
            className={cn('input-futuristic', showError('date') && 'has-error')}
            data-testid="input-date"
          />
          {showError('date') && (
            <p
              className="text-xs text-rose-300 flex items-center gap-1"
              data-testid="error-date"
            >
              <span className="inline-block h-1 w-1 rounded-full bg-rose-400" />
              {errors.date}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="vehicleNumber"
            className="text-white/70 text-xs uppercase tracking-wider"
          >
            Vehicle Number
          </Label>
          <input
            id="vehicleNumber"
            type="text"
            placeholder="e.g. ABC1234"
            value={value.vehicleNumber}
            onChange={(e) => {
              onChange({ ...value, vehicleNumber: e.target.value })
              markTouched('vehicleNumber')
            }}
            onBlur={() => markTouched('vehicleNumber')}
            className={cn(
              'input-futuristic',
              showError('vehicleNumber') && 'has-error',
            )}
            data-testid="input-vehicle"
          />
          {showError('vehicleNumber') && (
            <p
              className="text-xs text-rose-300 flex items-center gap-1"
              data-testid="error-vehicle"
            >
              <span className="inline-block h-1 w-1 rounded-full bg-rose-400" />
              {errors.vehicleNumber}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="kmUsage"
            className="text-white/70 text-xs uppercase tracking-wider"
          >
            Km Usage
          </Label>
          <input
            id="kmUsage"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="e.g. 45000"
            value={value.kmUsage === 0 ? '' : String(value.kmUsage)}
            onChange={(e) => {
              // Numeric sanitization: type="number" can still yield
              // partial garbage like "1e" at keystroke granularity; coerce
              // any non-finite remainder to 0 so validateForm treats it
              // as "missing" (positive-number error) instead of NaN
              // silently propagating into the report pipeline.
              const next = Number(e.target.value)
              onChange({
                ...value,
                kmUsage: Number.isFinite(next) ? next : 0,
              })
              markTouched('kmUsage')
            }}
            onBlur={() => markTouched('kmUsage')}
            className={cn('input-futuristic', showError('kmUsage') && 'has-error')}
            data-testid="input-km"
          />
          {showError('kmUsage') && (
            <p
              className="text-xs text-rose-300 flex items-center gap-1"
              data-testid="error-km"
            >
              <span className="inline-block h-1 w-1 rounded-full bg-rose-400" />
              {errors.kmUsage}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
