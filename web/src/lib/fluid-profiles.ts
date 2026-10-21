import type { FluidCardModel } from '@/lib/results-mapper'

/**
 * F1 (Tier 1 Industry): fluid threshold profiles.
 *
 * The device LCD keeps its own embedded grades (unchanged contract); this
 * module is the ADVISORY web layer that re-grades raw readings against the
 * fluid spec sheet the vehicle actually carries (DOT 3 vs DOT 4, mineral
 * vs synthetic). Pure functions, zero deps, no storage.
 */

export type ProfileGrade = 'GOOD' | 'WARNING' | 'CRITICAL'

export interface ProfileEvaluation {
  /** Matched profile id from the registry below. */
  profileId: string
  /** Human label, e.g. "DOT 4 (Cars / LCV)". */
  label: string
  kind: 'brake_oil' | 'engine_oil'
  grade: ProfileGrade
  /** Plain-language rationale shown in the badge tooltip body. */
  detail: string
}

export interface BrakeFluidProfile {
  id: string
  label: string
  kind: 'brake_oil'
  /** Moisture % at or above which the advisory turns WARNING. */
  moistureWarningPct: number
  /** Moisture % at or above which the advisory turns CRITICAL. */
  moistureCriticalPct: number
}

export interface EngineFluidProfile {
  id: string
  label: string
  kind: 'engine_oil'
  /**
   * Reference dielectric constant of fresh fluid (Er). The device measures
   * the used-oil Er; degradation and water contamination push it up.
   */
  baselineEr: number
}

export type FluidProfile = BrakeFluidProfile | EngineFluidProfile

export const BRAKE_PROFILES: BrakeFluidProfile[] = [
  { id: 'dot-3', label: 'DOT 3 (Conventional)', kind: 'brake_oil', moistureWarningPct: 2, moistureCriticalPct: 3 },
  { id: 'dot-4', label: 'DOT 4 (Cars / LCV)', kind: 'brake_oil', moistureWarningPct: 3, moistureCriticalPct: 4 },
  { id: 'dot-5.1', label: 'DOT 5.1 (High-Perf)', kind: 'brake_oil', moistureWarningPct: 3, moistureCriticalPct: 4 },
]

export const ENGINE_PROFILES: EngineFluidProfile[] = [
  { id: 'mineral-20w50', label: 'Mineral 20W-50', kind: 'engine_oil', baselineEr: 2.15 },
  { id: 'semi-10w40', label: 'Semi-Synthetic 10W-40', kind: 'engine_oil', baselineEr: 2.25 },
  { id: 'synth-5w30', label: 'Full Synthetic 5W-30', kind: 'engine_oil', baselineEr: 2.35 },
]

export const ALL_PROFILES: FluidProfile[] = [...BRAKE_PROFILES, ...ENGINE_PROFILES]

export function getProfile(id: string | null | undefined): FluidProfile | null {
  return ALL_PROFILES.find((p) => p.id === id) ?? null
}

function gradeFromRelativeDelta(delta: number): ProfileGrade {
  // The absolute Er >= 2.80 water-intrusion limit is already governed in
  // evaluateAgainstProfile; here we only measure degradation drift from
  // the profile's fresh-fluid baseline.
  return delta >= 0.20 ? 'CRITICAL' : delta >= 0.05 ? 'WARNING' : 'GOOD'
}

/**
 * Re-grades a mapped card against the selected profile. Returns null when
 * there is nothing to grade: unknown profile id, kind mismatch, or a
 * card that produced no real measurement (noData / transport error).
 */
export function evaluateAgainstProfile(
  model: FluidCardModel,
  profileId: string | null | undefined,
): ProfileEvaluation | null {
  const profile = getProfile(profileId)
  if (!profile || profile.kind !== model.kind) return null
  if (model.noData || model.hasError) return null

  if (profile.kind === 'brake_oil') {
    // Parse the device's moisture string ("3%", "Impurity: 5%") down to a
    // number; unparsable readings are honest "no evaluation".
    const match = /([\d.]+)/.exec(model.primaryMetric)
    const pct = match ? Number(match[1]) : Number.NaN
    if (!Number.isFinite(pct)) return null

    const grade: ProfileGrade =
      pct >= profile.moistureCriticalPct
        ? 'CRITICAL'
        : pct >= profile.moistureWarningPct
          ? 'WARNING'
          : 'GOOD'
    return {
      profileId: profile.id,
      label: profile.label,
      kind: profile.kind,
      grade,
      detail: `${pct.toFixed(1)}% vs ${profile.label} (warn >= ${profile.moistureWarningPct}%, critical >= ${profile.moistureCriticalPct}%)`,
    }
  }

  // engine_oil: evaluate the dielectric shift vs the profile baseline.
  const match = /([\d.]+)/.exec(model.primaryMetric)
  const er = match ? Number(match[1]) : Number.NaN
  if (!Number.isFinite(er)) return null

  const delta = er - profile.baselineEr
  if (er >= 2.8) {
    return {
      profileId: profile.id,
      label: profile.label,
      kind: 'engine_oil',
      grade: 'CRITICAL',
      detail: `Er ${er.toFixed(2)} vs ${profile.label} (water intrusion limit 2.80)`,
    }
  }
  const grade = gradeFromRelativeDelta(delta)
  return {
    profileId: profile.id,
    label: profile.label,
    kind: 'engine_oil',
    grade,
    detail: `Er ${er.toFixed(2)} vs baseline ${profile.baselineEr.toFixed(2)} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`,
  }
}

export interface ProfileSelection {
  brakeProfileId: string | null
  engineProfileId: string | null
}

export function evaluateAllResults(
  results: FluidCardModel[],
  selection: ProfileSelection,
): Record<FluidCardModel['kind'], ProfileEvaluation | null> {
  const out: Record<FluidCardModel['kind'], ProfileEvaluation | null> = {
    brake_oil: null,
    engine_oil: null,
    coolant: null,
  }
  for (const card of results) {
    const id = card.kind === 'brake_oil' ? selection.brakeProfileId : selection.engineProfileId
    out[card.kind] = evaluateAgainstProfile(card, id)
  }
  return out
}
