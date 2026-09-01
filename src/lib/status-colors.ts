import type { FluidStatus } from '@/types/fluid'

export type StatusColor = 'green' | 'yellow' | 'red' | 'gray'

export interface StatusVisual {
  color: StatusColor
  /** Tailwind classes for the background pill */
  bgClass: string
  /** Tailwind classes for text */
  textClass: string
  /** Tailwind classes for the neon border */
  borderClass: string
  /** Glow utility (defined in index.css) */
  glowClass: string
  /** Hex color used for inline dot accent */
  dotHex: string
  /** Human-readable label */
  label: string
}

const GOOD_VISUAL: StatusVisual = {
  color: 'green',
  bgClass: 'bg-emerald-500/15',
  textClass: 'text-emerald-300',
  borderClass: 'border-emerald-400/40',
  glowClass: 'glow-green',
  dotHex: '#10b981',
  label: 'GOOD',
}

const WARNING_VISUAL: StatusVisual = {
  color: 'yellow',
  bgClass: 'bg-amber-500/15',
  textClass: 'text-amber-300',
  borderClass: 'border-amber-400/40',
  glowClass: 'glow-yellow',
  dotHex: '#f59e0b',
  label: 'WARNING',
}

const CRITICAL_VISUAL: StatusVisual = {
  color: 'red',
  bgClass: 'bg-rose-500/15',
  textClass: 'text-rose-300',
  borderClass: 'border-rose-400/40',
  glowClass: 'glow-red',
  dotHex: '#f43f5e',
  label: 'CRITICAL',
}

const ERROR_VISUAL: StatusVisual = {
  color: 'gray',
  bgClass: 'bg-slate-500/15',
  textClass: 'text-slate-300',
  borderClass: 'border-slate-400/30',
  glowClass: 'glow-gray',
  dotHex: '#94a3b8',
  label: 'ERROR',
}

const UNKNOWN_VISUAL: StatusVisual = {
  color: 'gray',
  bgClass: 'bg-slate-500/15',
  textClass: 'text-slate-300',
  borderClass: 'border-slate-400/30',
  glowClass: 'glow-gray',
  dotHex: '#94a3b8',
  label: 'UNKNOWN',
}

const NO_DATA_VISUAL: StatusVisual = {
  color: 'gray',
  bgClass: 'bg-slate-500/10',
  textClass: 'text-slate-400',
  borderClass: 'border-slate-400/20',
  glowClass: 'glow-gray',
  dotHex: '#64748b',
  label: 'NO DATA',
}

/**
 * Maps a raw status string from the ESP32 (or a synthetic UI status) to
 * a strict set of three safety colors + one fallback gray for errors.
 *
 * Spec (locked Phase 1):
 *   GOOD / NORMAL  -> green
 *   WARNING / BAD  -> yellow/orange
 *   CRITICAL       -> red
 *   NO_DATA / UNKNOWN / ERROR / missing -> gray
 */
export function getStatusVisual(status: FluidStatus | string | null | undefined): StatusVisual {
  if (status == null) return ERROR_VISUAL
  const normalized = String(status).trim().toUpperCase()

  switch (normalized) {
    case 'GOOD':
    case 'NORMAL':
      return GOOD_VISUAL
    case 'WARNING':
    case 'BAD':
      return WARNING_VISUAL
    case 'CRITICAL':
      return CRITICAL_VISUAL
    case 'NO_DATA':
      return NO_DATA_VISUAL
    case 'ERROR':
      return ERROR_VISUAL
    case 'UNKNOWN':
      return UNKNOWN_VISUAL
    default:
      // Unknown raw status from ESP32: log and fall back to gray
      if (typeof console !== 'undefined') {
        console.warn(`[FlowMetrics] Unknown fluid status: ${status}`)
      }
      return UNKNOWN_VISUAL
  }
}
