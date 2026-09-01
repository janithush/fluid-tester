import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { FluidCardModel, VehicleForm } from '@/types/fluid'
import { getStatusVisual } from './status-colors'

/**
 * Pure decision function: should the report button be enabled?
 * It requires the form to be valid AND at least one fluid result to exist.
 *
 * `noData` is acceptable here — a card with noData still has a real
 * (universal) entry in the report ("No measurement"). A `hasError` card
 * (transport / parse failure) is treated as "no result" and disqualifies
 * the row.
 */
export function canGenerateReport(
  form: VehicleForm,
  results: FluidCardModel[] | null,
): boolean {
  if (!results || results.length === 0) return false
  const hasAnyResult = results.some((r) => !r.hasError)
  if (!hasAnyResult) return false
  if (!form.date || !form.vehicleNumber?.trim() || !(Number(form.kmUsage) > 0)) {
    return false
  }
  return true
}

export interface GenerateReportInput {
  form: VehicleForm
  results: FluidCardModel[]
}

/**
 * Formats a card's primary metric for the PDF.
 *
 * - noData: gray italic "No measurement"
 * - hasError: "N/A"
 * - engine_oil (live): multi-line cell with primary + all sub-metrics, one
 *   per line. The "Status" column is unaffected.
 * - otherwise: the card's primaryMetric only
 */
export function formatMetricForPdf(card: FluidCardModel): string {
  if (card.noData) return 'No measurement'
  if (card.hasError) return 'N/A'
  if (card.kind === 'engine_oil') {
    return [card.primaryMetric, ...card.secondaryMetrics].join('\n')
  }
  return card.primaryMetric
}

/**
 * Generates and triggers a download of a PDF report. Pure with respect to
 * the inputs — the side effect is the file download.
 *
 * Emoji icons (🛢️, ⚙️, ❄️) are deliberately NOT rendered because jsPDF's
 * default Helvetica font has no glyph coverage for them. They would
 * otherwise appear as mojibake in the final document.
 */
export function generateReport({ form, results }: GenerateReportInput): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  const pageWidth = doc.internal.pageSize.getWidth()

  // Header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.text('FlowMetrics', 40, 50)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('Automotive Fluid Condition Report', 40, 70)

  // Divider
  doc.setDrawColor(200)
  doc.line(40, 85, pageWidth - 40, 85)

  // Vehicle metadata
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Vehicle Information', 40, 110)
  doc.setFont('helvetica', 'normal')
  doc.text(`Date:        ${form.date}`, 40, 130)
  doc.text(`Vehicle No:  ${form.vehicleNumber}`, 40, 146)
  doc.text(`Km Usage:    ${form.kmUsage}`, 40, 162)

  // Results table
  // Note: icons are intentionally omitted (jsPDF Helvetica cannot render
  // emoji). The card UI on the device still shows them.
  const body = results.map((r) => {
    const visual = getStatusVisual(r.status)
    return [r.title, formatMetricForPdf(r), visual.label]
  })

  autoTable(doc, {
    startY: 190,
    head: [['Fluid', 'Reading', 'Status']],
    body,
    styles: { fontSize: 11, cellPadding: 8 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: {
      0: { cellWidth: 180 },
      1: { cellWidth: 180 },
      2: { cellWidth: 120, fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body') {
        // Read the title cell of the same row. autoTable exposes sibling
        // cells via `data.row.raw` (an array of cell content for that row).
        // This is more robust than assuming row.index === 1 because the
        // report could one day support re-ordered cards.
        // The library type for `row.raw` is a union (DOM Row vs RowInput),
        // so we cast to a known shape to read the first column safely.
        const titleCell = (data.row.raw as unknown as unknown[] | undefined)?.[0]
        const isEngineRow = typeof titleCell === 'string' && titleCell === 'Engine Oil'

        if (data.column.index === 1) {
          // Reading column: italicize noData text and shrink the engine
          // oil row's font so all 6 lines (primary + 5 sub-metrics) fit
          // in the 180pt column on A4 portrait.
          const raw = String(data.cell.raw ?? '')
          if (raw === 'No measurement') {
            data.cell.styles.fontStyle = 'italic'
            data.cell.styles.textColor = [120, 120, 120]
          }
          if (isEngineRow && raw.includes('\n')) {
            data.cell.styles.fontSize = 8
            data.cell.styles.cellPadding = 4
          }
        }
        if (data.column.index === 2) {
          const status = String(data.cell.raw ?? '').toUpperCase()
          if (status === 'GOOD' || status === 'NORMAL') {
            data.cell.styles.textColor = [22, 101, 52]
          } else if (status === 'WARNING' || status === 'BAD') {
            data.cell.styles.textColor = [161, 98, 7]
          } else if (status === 'CRITICAL') {
            data.cell.styles.textColor = [185, 28, 28]
          } else {
            data.cell.styles.textColor = [82, 82, 82]
          }
        }
      }
    },
  })

  // Footer
  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } })
    .lastAutoTable?.finalY ?? 300
  doc.setFontSize(9)
  doc.setTextColor(120)
  doc.text(
    `Generated by FlowMetrics on ${new Date().toLocaleString()}`,
    40,
    finalY + 30,
  )

  const filename = `FlowMetrics_${form.vehicleNumber}_${form.date}.pdf`
  doc.save(filename)
}
