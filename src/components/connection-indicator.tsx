import { cn } from '@/lib/utils'
import type { StreamStatus } from '@/hooks/useFluidStream'

interface ConnectionIndicatorProps {
  status: StreamStatus
  /** When true, the dot is animated to suggest active streaming. */
  isStreaming: boolean
  /** Optional className for the wrapper span. */
  className?: string
}

const STATUS_LABEL: Record<StreamStatus, string> = {
  idle: 'IDLE',
  connecting: 'CONNECTING',
  streaming: 'LIVE',
  error: 'OFFLINE',
}

const STATUS_DOT: Record<StreamStatus, string> = {
  idle: 'bg-slate-500',
  connecting: 'bg-amber-400',
  streaming: 'bg-emerald-400',
  error: 'bg-rose-500',
}

const STATUS_GLOW: Record<StreamStatus, string> = {
  idle: '',
  connecting: 'shadow-[0_0_8px_rgba(251,191,36,0.7)]',
  streaming: 'shadow-[0_0_10px_rgba(52,211,153,0.8)]',
  error: 'shadow-[0_0_8px_rgba(244,63,94,0.7)]',
}

/**
 * Small live-connection pill shown in the app header. The pulse animation
 * is gated on `isStreaming` so it only animates while frames are flowing.
 */
export function ConnectionIndicator({
  status,
  isStreaming,
  className,
}: ConnectionIndicatorProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-white/70',
        className,
      )}
      data-testid="connection-indicator"
      data-stream-status={status}
    >
      <span
        className={cn(
          'inline-block h-1.5 w-1.5 rounded-full',
          STATUS_DOT[status],
          STATUS_GLOW[status],
          isStreaming && 'animate-pulse',
        )}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  )
}