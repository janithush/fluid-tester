import type { VehicleForm } from '@/types/fluid'
import type { FluidCardModel } from '@/lib/results-mapper'

/**
 * F5 (Tier 1 Industry): machine-readable session export.
 * Fleet operators ingest these into maintenance spreadsheets / records;
 * the customer-facing artifact remains the PDF report (protected pipeline).
 * Blob + anchor click only - no external deps, works fully offline.
 */

export interface SessionExportInput {
  form: VehicleForm
  results: FluidCardModel[]
}

export const CSV_HEADERS = [
  'Timestamp',
  'Date',
  'Vehicle No',
  'Km Usage',
  'Fluid',
  'Reading',
  'Dielectric',
  'Capacitance (pF)',
  'Status',
] as const

/** CSV field escaping per RFC 4180 (quotes + doubled inner quotes). */
function csvCell(value: string | number | null | undefined): string {
  const s = String(value ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Pulls the numeric dielectric out of the engine card's primary metric
 * ("Dielectric 2.40"); returns '' when absent so fleet sheets can filter
 * blanks instead of lies.
 */
function matchFirstNumber(text: string): string {
  const match = /([\d.]+)/.exec(text)
  return match ? match[1] : ''
}

function matchSecondary(secondary: string[], label: string): string {
  const line = secondary.find((m) => m.startsWith(`${label}:`))
  if (!line) return ''
  const value = line.slice(label.length + 2).trim()
  return value === 'N/A' ? '' : matchFirstNumber(value)
}

export function toSessionCsv({ form, results }: SessionExportInput): string {
  const lines: string[] = [CSV_HEADERS.join(',')]
  for (const card of results) {
    const isEngine = card.kind === 'engine_oil'
    lines.push(
      [
        csvCell(new Date().toISOString()),
        csvCell(form.date),
        csvCell(form.vehicleNumber),
        csvCell(form.kmUsage),
        csvCell(card.title),
        csvCell(card.noData ? 'No measurement' : card.primaryMetric),
        csvCell(isEngine && !card.noData ? matchFirstNumber(card.primaryMetric) : ''),
        csvCell(
          isEngine && !card.noData
            ? matchSecondary(card.secondaryMetrics, 'Capacitance')
            : '',
        ),
        csvCell(card.status),
      ].join(','),
    )
  }
  return `${lines.join('\r\n')}\r\n`
}

export function toSessionJson({ form, results }: SessionExportInput): string {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), form, results },
    null,
    2,
  )
}

/** Triggers a client-side download. Falls back to a data: URI when the
 * environment lacks createObjectURL (e.g. jsdom), so exports never throw. */
function triggerDownload(content: string, filename: string, mime: string): void {
  try {
    const a = document.createElement('a')
    let url: string | null = null
    try {
      url = URL.createObjectURL(new Blob([content], { type: mime }))
    } catch {
      url = null
    }
    a.href = url ?? `data:${mime};charset=utf-8,${encodeURIComponent(content)}`
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (url) URL.revokeObjectURL(url)
  } catch {
    // Download is a best-effort side effect; never crash the session.
  }
}

export function exportSessionAsCsv(input: SessionExportInput, filename?: string): void {
  const safeVehicle = input.form.vehicleNumber.replace(/[^A-Za-z0-9-_ ]/g, '')
  triggerDownload(
    toSessionCsv(input),
    filename ?? `FlowMetrics_${safeVehicle || 'session'}_${input.form.date || 'undated'}.csv`,
    'text/csv',
  )
}

export function exportSessionAsJson(input: SessionExportInput, filename?: string): void {
  const safeVehicle = input.form.vehicleNumber.replace(/[^A-Za-z0-9-_ ]/g, '')
  triggerDownload(
    toSessionJson(input),
    filename ?? `FlowMetrics_${safeVehicle || 'session'}_${input.form.date || 'undated'}.json`,
    'application/json',
  )
}
