import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { getStatusVisual } from '@/lib/status-colors'
import { listRunsByVehicle } from '@/lib/history-db'
import type { DiagnosticRun } from '@/lib/history-db'

/**
 * F4 UI: light historical context for the vehicle number being typed.
 * - "Past runs" mini-list with per-fluid verdict chips.
 * - An SVG polyline sparkline (zero deps) of dielectric / moisture
 *   progression across km intervals once >= 2 runs exist.
 * Everything degrades to hidden when IndexedDB is unavailable (jsdom
 * tests, private-mode edge cases) - never blocks the primary session.
 */

function extractEr(run: DiagnosticRun): number | null {
  const card = run.cards.find((c) => c.kind === 'engine_oil')
  if (!card || card.noData || card.hasError) return null
  const match = /([\d.]+)/.exec(card.primaryMetric)
  return match ? Number(match[1]) : null
}

function extractMoisture(run: DiagnosticRun): number | null {
  const card = run.cards.find((c) => c.kind === 'brake_oil')
  if (!card || card.noData || card.hasError) return null
  const match = /([\d.]+)/.exec(card.primaryMetric)
  return match ? Number(match[1]) : null
}

/** Stringifies mapped pixel points into an SVG polyline `points` value. */
function polyline(points: Array<{ x: number; y: number }>): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

// Trend canvas geometry (viewBox units; the SVG stretches via CSS width).
// "none" preserveAspectRatio lets the same path coordinates fill any card
// width; polylines carry vector-effect so strokes stay 2 CSS px thick.
const VG_W = 300
const VG_H = 60
const PAD_X = 12
const PAD_Y = 6
const DOT_R = 3

function sparklineY(values: Array<number | null>): Array<number | null> {
  const nums = values.filter((v): v is number => v !== null)
  if (nums.length < 2) return values
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const span = max - min || 1
  return values.map((v) =>
    v === null ? null : PAD_Y + (VG_H - 2 * PAD_Y) * (1 - (v - min) / span),
  )
}

export function HistoryStrip({
  vehicleNumber,
  refreshKey = 0,
}: {
  vehicleNumber: string
  /** F4: bumped by App after each save so a fresh run shows immediately. */
  refreshKey?: number
}) {
  const [runs, setRuns] = useState<DiagnosticRun[] | null>(null)

  // Debounced lookup: typing "WP-CAB-1..." must not fire five IDB scans.
  // `refreshKey` joins the deps so a completed session re-queries instantly.
  useEffect(() => {
    const plate = vehicleNumber.trim()
    if (!plate) {
      setRuns(null)
      return
    }
    let cancelled = false
    console.log('[HistoryStrip] Querying for:', plate)
    const timer = window.setTimeout(() => {
      listRunsByVehicle(plate)
        .then((found) => {
          console.log('[HistoryStrip] Found records:', found)
          if (!cancelled) setRuns(found)
        })
        .catch((err) => {
          console.warn('[HistoryStrip] IndexedDB lookup failed:', err)
          if (!cancelled) setRuns(null)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [vehicleNumber, refreshKey])

  if (!runs || runs.length === 0) return null

  // Trend series: oldest -> newest. X is proportional to the km interval
  // range (an odometer axis, not just an index), so uneven service gaps
  // render with faithful spacing; degenerate equal-km sessions fall back
  // to an even spread between the padding edges.
  const ordered = [...runs].reverse()
  const engineYs = sparklineY(ordered.map(extractEr))
  const brakeYs = sparklineY(ordered.map(extractMoisture))

  const kmList = ordered.map((r) => r.kmUsage)
  const minKm = Math.min(...kmList)
  const maxKm = Math.max(...kmList)
  const kmSpan = maxKm - minKm
  const xFor = (km: number, index: number): number =>
    kmSpan > 0
      ? PAD_X + (VG_W - 2 * PAD_X) * ((km - minKm) / kmSpan)
      : ordered.length === 1
        ? VG_W / 2
        : PAD_X + (VG_W - 2 * PAD_X) * (index / (ordered.length - 1))

  const enginePoints = ordered
    .map((run, i) => ({ x: xFor(run.kmUsage, i), y: engineYs[i], km: run.kmUsage }))
    .filter((p): p is { x: number; y: number; km: number } => p.y !== null)

  const brakePoints = ordered
    .map((run, i) => ({ x: xFor(run.kmUsage, i), y: brakeYs[i], km: run.kmUsage }))
    .filter((p): p is { x: number; y: number; km: number } => p.y !== null)

  return (
    <Card className="glass rounded-2xl" data-testid="history-strip">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
            Past Runs ({runs.length})
          </span>
          {ordered.length > 1 && (
            <span className="text-[10px] uppercase tracking-wider text-white/30">
              {ordered[0].kmUsage.toLocaleString()} km -{' '}
              {ordered[ordered.length - 1].kmUsage.toLocaleString()} km
            </span>
          )}
        </div>

        {/* Degradation trend: full-width SVG polylines + dot markers
            per fluid (no chart libs). The svg flexes across the card and
            the legend sits beside it on the same row. */}
        {ordered.length > 1 && (enginePoints.length >= 1 || brakePoints.length >= 1) && (
          <div className="flex items-center gap-3" data-testid="history-trend">
            <svg
              viewBox={`0 0 ${VG_W} ${VG_H}`}
              preserveAspectRatio="none"
              className="h-16 min-w-0 flex-1"
              role="img"
              aria-label="Degradation trend across service intervals"
              data-testid="history-trend-svg"
            >
              {brakePoints.length >= 1 &&
                brakePoints.map((p, i) => (
                  <circle
                    key={`brake-dot-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={DOT_R}
                    fill="#fb7185"
                    stroke="#881337"
                    strokeWidth="1"
                  />
                ))}
              {enginePoints.length >= 1 &&
                enginePoints.map((p, i) => (
                  <circle
                    key={`engine-dot-${i}`}
                    cx={p.x}
                    cy={p.y}
                    r={DOT_R}
                    fill="#fbbf24"
                    stroke="#78350f"
                    strokeWidth="1"
                  />
                ))}
              {brakePoints.length > 1 && (
                <polyline
                  points={polyline(brakePoints)}
                  fill="none"
                  stroke="#fb7185"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {enginePoints.length > 1 && (
                <polyline
                  points={polyline(enginePoints)}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>
            <div className="flex shrink-0 flex-col gap-1 text-[10px] uppercase tracking-wider text-white/40">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-1 w-3 rounded-full bg-rose-300" /> Brake moisture
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-1 w-3 rounded-full bg-amber-400" /> Engine dielectric
              </span>
            </div>
          </div>
        )}

          {/* Single-run state: no trend math possible yet, but the record
              must still be visible; previously the whole card was hidden. */}
          {ordered.length === 1 && (
            <p
              className="text-xs text-white/50 border-t border-white/5 pt-1.5"
              data-testid="history-single-run"
            >
              1 Diagnostic Record Found - Run a 2nd test to plot wear trend
            </p>
          )}

          <ul className="space-y-1.5" data-testid="history-list">
          {runs.slice(0, 5).map((run) => (
            <li
              key={run.id ?? run.createdAt}
              className="flex items-center justify-between gap-2 border-t border-white/5 pt-1.5 text-xs"
            >
              <span className="text-white/60">
                {run.date} - {run.kmUsage.toLocaleString()} km
              </span>
              <span className="flex gap-1.5">
                {run.cards
                  .filter((c) => c.kind !== 'coolant')
                  .map((card) => {
                    const visual = getStatusVisual(card.rawStatus ?? card.status)
                    return (
                      <span
                        key={card.kind}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${visual.bgClass} ${visual.textClass} ${visual.borderClass}`}
                      >
                        {card.title.split(' ')[0]}: {card.rawStatus ?? visual.label}
                      </span>
                    )
                  })}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
