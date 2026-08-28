/**
 * Fixed preset registry (plan T12): exactly three terrain presets —
 * Archipelago, Continent, Highlands — as parameter snapshots: the two slider
 * positions plus a small set of `FieldParams` overrides that shape terrain
 * beyond what the elevation slider can reach (falloff/freq/octaves). No
 * user-defined presets (town-hall: fixed scope).
 *
 * Pure data — no DOM, no controller imports. The panel builds its preset
 * buttons straight from `PRESETS` (so UI and registry can never drift), and
 * `MapController.applyPreset` consumes the same snapshot. Ids are lowercase
 * slugs matching T13's wire pattern `/^[a-z]{1,24}$/` (see `urlState.ts`).
 *
 * Terrain character intent (taste-tunable constants; visual sign-off happens
 * in the coordinator's browser pass):
 * - archipelago — strong rim falloff + an extra elevation octave scatter the
 *   land into islands around a high slider position. Falloff 0.35 → 0.7 in
 *   T3b (percentile normalization had inflated ~21% land back to islands' 11%).
 *   T3c pins `elevationNormHigh: 0.9998`: inheriting the new near-max default
 *   (0.99999) starved the islets' rare mountain pixels — the slightly lower
 *   shoulder keeps a trace of rock on the big islands while holding snow
 *   ≤ 0.5% and land 3–15% at every measured seed.
 * - continent — ONE dominant landmass with coastal water. T3c recalibration:
 *   slider 0.4 → 0.3 (softer redistribution 1.44 → 1.38 grows the landmass
 *   into its saddles), a new `elevationFreq: 2.72` override (bigger features
 *   than the slider-derived 3.1 — feature scale, not the slider mapping, is
 *   what buys coherence), falloff 0.08 (drowns rim islands), and the
 *   near-max/zero normalization shoulders (`elevationNormHigh: 0.99999`,
 *   `elevationNormLow: 0`) so snow caps the peaks instead of out-sizing the
 *   mountain band. Measured at 512² × 8 seeds: largest land component ≥ 55.8%
 *   of land at every seed (was 37–85%), mountain ≥ snow at every seed,
 *   ocean 46% (floor 45%).
 * - highlands — tall rugged terrain, no islanding, dry climate. T3c
 *   recalibration: slider 0.95 → 0.75 and a big-feature `elevationFreq: 1.5`
 *   override (the old small-scale 4.4 fragmented the landmass into mesas —
 *   largest component 26–67% of land); falloff 0.06 pulls the mass together
 *   (coherence ≥ 56.3% at every measured seed); `elevationNormHigh: 0.997`
 *   balances the T3b goal (mountain ≥ 2%, snow ≥ 0.5%) against the T3c
 *   ratio (snow ≤ mountain); moisture slider 0.35 → 0.15 deepens the
 *   committed "drier climate" so the dry half of the mountain band feeds the
 *   mountain biome (with the old 0.35, snow out-sized mountain at every
 *   seed). Measured: mountain 2.09–2.9%, snow 1.5–2.8%, land ≥ 38%.
 */
import type { FieldParams } from '../generation/index.ts';

/**
 * Field-shaping keys a preset may override. Deliberately excludes
 * `redistribution` (the one remaining slider-derived key) and every
 * seed-stability key (`moistureSeedOffset` and friends) — those belong to the
 * slider mapping / generation invariants, not to terrain character presets.
 * `elevationFreq` was T3c's sanctioned allowlist extension: presets may set
 * feature SCALE directly (the elevation slider still owns it for manual
 * terrain; a preset override only applies while the preset is installed).
 * The T3b normalization shoulders (`elevationNormLow`/`elevationNormHigh`)
 * are allowed: they are terrain-character calibration, not slider-derived.
 */
export type PresetOverrideKeys = Pick<
  FieldParams,
  | 'falloffStrength'
  | 'elevationFreq'
  | 'elevationOctaves'
  | 'moistureFreq'
  | 'moistureOctaves'
  | 'elevationNormLow'
  | 'elevationNormHigh'
>;

export interface PresetDefinition {
  /** Wire id (T13 URL state): lowercase slug matching /^[a-z]{1,24}$/. */
  id: 'archipelago' | 'continent' | 'highlands';
  /** Display name (also the panel button label). */
  name: string;
  /** Elevation slider position to apply, [0,1]. */
  elevation: number;
  /** Moisture slider position to apply, [0,1]. */
  moisture: number;
  /** FieldParams overrides layered over the slider-derived params. */
  overrides: Partial<PresetOverrideKeys>;
}

export const PRESETS: readonly PresetDefinition[] = [
  {
    id: 'archipelago',
    name: 'Archipelago',
    elevation: 0.85,
    moisture: 0.55,
    overrides: { falloffStrength: 0.7, elevationOctaves: 6, elevationNormHigh: 0.9998 },
  },
  {
    id: 'continent',
    name: 'Continent',
    elevation: 0.3,
    moisture: 0.5,
    overrides: {
      falloffStrength: 0.08,
      elevationFreq: 2.72,
      elevationNormLow: 0,
      elevationNormHigh: 0.99999,
    },
  },
  {
    id: 'highlands',
    name: 'Highlands',
    elevation: 0.75,
    moisture: 0.15,
    overrides: {
      falloffStrength: 0.06,
      elevationFreq: 1.5,
      elevationNormLow: 0,
      elevationNormHigh: 0.997,
      moistureOctaves: 4,
    },
  },
];

/** Registry lookup by wire id; unknown/absent ids yield `null` (never throws). */
export function findPreset(id: string | null): PresetDefinition | null {
  return PRESETS.find((preset) => preset.id === id) ?? null;
}
