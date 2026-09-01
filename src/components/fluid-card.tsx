import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getStatusVisual } from '@/lib/status-colors'
import type { FluidCardModel } from '@/lib/results-mapper'

interface FluidCardProps {
  model: FluidCardModel
}

const ICON_BG: Record<FluidCardModel['kind'], string> = {
  brake_oil: 'from-rose-500/20 to-orange-500/20 border-rose-400/30',
  engine_oil: 'from-amber-500/20 to-yellow-500/20 border-amber-400/30',
  coolant: 'from-cyan-500/20 to-blue-500/20 border-cyan-400/30',
}

const ICON_GLYPH: Record<FluidCardModel['kind'], string> = {
  brake_oil: '🛢️',
  engine_oil: '⚙️',
  coolant: '❄️',
}

export function FluidResultCard({ model }: FluidCardProps) {
  const visual = getStatusVisual(model.status)
  const iconBg = ICON_BG[model.kind]
  const icon = ICON_GLYPH[model.kind]

  return (
    <Card
      className={cn(
        'glass rounded-2xl',
        model.noData && 'border-dashed opacity-80',
        visual.borderClass,
      )}
      data-testid={`fluid-card-${model.kind}`}
      data-status={model.status}
      data-nodata={model.noData ? 'true' : 'false'}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-3 text-white">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg border bg-gradient-to-br text-xl',
              iconBg,
            )}
            aria-hidden="true"
          >
            {icon}
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold leading-tight">
              {model.title}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-white/40">
              Diagnostic Module
            </span>
          </div>
        </CardTitle>

        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider',
            visual.bgClass,
            visual.textClass,
            visual.borderClass,
            visual.glowClass,
          )}
          data-testid={`status-badge-${model.kind}`}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: visual.dotHex, boxShadow: `0 0 8px ${visual.dotHex}` }}
            aria-hidden="true"
          />
          {visual.label}
        </span>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-baseline gap-2">
          {model.noData ? (
            <p
              className="text-base italic text-white/40"
              data-testid={`metric-${model.kind}`}
              data-nodata="true"
            >
              {model.primaryMetric}
            </p>
          ) : (
            <p
              className="text-3xl font-bold tabular-nums text-white"
              data-testid={`metric-${model.kind}`}
            >
              {model.primaryMetric}
            </p>
          )}
        </div>
        {!model.noData && model.secondaryMetrics.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-white/5 pt-3 text-sm text-white/60">
            {model.secondaryMetrics.map((m) => {
              // Derive a slug for the data-testid. The first whitespace
              // run in each line is the label (e.g. "TBN: 8.20 mg KOH/g"
              // -> slug "tbn"). Falls back to a numeric index if no
              // recognizable label.
              const label = m.split(':')[0]?.trim().toLowerCase().replace(/\s+/g, '-') ?? 'item'
              return (
                <li
                  key={m}
                  className="flex items-center gap-2"
                  data-testid={`submetric-${model.kind}-${label}`}
                >
                  <span className="inline-block h-1 w-1 rounded-full bg-cyan-400/60" />
                  {m}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
