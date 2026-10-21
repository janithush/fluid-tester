import { BRAKE_PROFILES, ENGINE_PROFILES } from '@/lib/fluid-profiles'

/**
 * F1 UI: fluid spec-sheet selector. Defaults are the workshop majority
 * (DOT 4 + semi-synthetic) and persist for the session; the device LCD
 * grades remain untouched - these choices only drive the advisory badges.
 */
export function ProfileSelect({
  brakeProfileId,
  engineProfileId,
  onChange,
}: {
  brakeProfileId: string | null
  engineProfileId: string | null
  onChange: (next: { brakeProfileId: string | null; engineProfileId: string | null }) => void
}) {
  return (
    <div
      className="glass flex flex-wrap items-center gap-4 rounded-2xl px-4 py-3"
      data-testid="profile-select"
    >
      <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">
        Fluid Spec
      </span>
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/40">Brake</span>
        <select
          value={brakeProfileId ?? ''}
          onChange={(e) => onChange({ brakeProfileId: e.target.value, engineProfileId })}
          data-testid="profile-select-brake"
          className="h-10 rounded-lg border border-cyan-400/30 bg-[#0a0f24] px-2 text-sm text-white outline-none focus:border-cyan-400/60"
        >
          <option value="">No profile (device grade only)</option>
          {BRAKE_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-white/40">Engine</span>
        <select
          value={engineProfileId ?? ''}
          onChange={(e) => onChange({ brakeProfileId, engineProfileId: e.target.value })}
          data-testid="profile-select-engine"
          className="h-10 rounded-lg border border-cyan-400/30 bg-[#0a0f24] px-2 text-sm text-white outline-none focus:border-cyan-400/60"
        >
          <option value="">No profile (device grade only)</option>
          {ENGINE_PROFILES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
