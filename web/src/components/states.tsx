import { Card, CardContent } from '@/components/ui/card'

export function EmptyState() {
  return (
    <Card
      className="glass rounded-2xl border-dashed border-white/10"
      data-testid="empty-state"
    >
      <CardContent className="flex flex-col items-center justify-center py-14 text-center">
        <div className="relative mb-5">
          <div
            className="absolute inset-0 rounded-full bg-cyan-500/20 blur-2xl"
            aria-hidden="true"
          />
          <div
            className="relative flex h-20 w-20 items-center justify-center rounded-full border border-cyan-400/30 bg-gradient-to-br from-cyan-500/10 to-purple-500/10 text-4xl glow-cyan"
            aria-hidden="true"
          >
            🔬
          </div>
        </div>
        <p className="text-base font-medium text-white">
          System Standby
        </p>
        <p className="mt-1.5 max-w-xs text-xs text-white/50">
          Trigger the test on the ESP32 device, then tap
          <span className="mx-1 text-cyan-300">&ldquo;Fetch Latest Reading&rdquo;</span>
          to begin diagnostics.
        </p>
      </CardContent>
    </Card>
  )
}

export function FluidCardSkeleton() {
  return (
    <Card className="glass rounded-2xl" data-testid="fluid-skeleton">
      <CardContent className="space-y-3 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 animate-pulse rounded-lg bg-white/5" />
            <div className="space-y-1.5">
              <div className="h-3 w-24 animate-pulse rounded bg-white/10" />
              <div className="h-2 w-16 animate-pulse rounded bg-white/5" />
            </div>
          </div>
          <div className="h-6 w-16 animate-pulse rounded-full bg-white/10" />
        </div>
        <div className="h-8 w-1/2 animate-pulse rounded bg-white/5" />
        <div className="h-2 w-1/3 animate-pulse rounded bg-white/5" />
      </CardContent>
    </Card>
  )
}
