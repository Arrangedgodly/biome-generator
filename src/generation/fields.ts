/**
 * Terrain field generation: turns fBm noise into per-pixel elevation and
 * moisture fields. Pure functions — no DOM, no workers (wiring is T5).
 */
import { createFbm2D } from '../noise/fbm.ts';

export interface FieldParams {
  /** fBm frequency for the elevation field (cycles across the map). */
  elevationFreq: number; // default 3.5
  elevationOctaves: number; // default 5
  elevationLacunarity: number; // default 2.0
  elevationGain: number; // default 0.5
  /** Post-noise exponent: >1 flattens lowlands and sharpens peaks. */
  redistribution: number; // default 1.5
  /** 0 = no islanding; higher pushes map edges toward ocean. */
  falloffStrength: number; // default 0.0 (see CALIBRATION note below)
  /** fBm frequency for the moisture field. */
  moistureFreq: number; // default 2.5
  moistureOctaves: number; // default 3
  moistureLacunarity: number; // default 2.0
  moistureGain: number; // default 0.5
  /** Deterministic seed offset separating moisture noise from elevation noise. */
  moistureSeedOffset: number; // default 7919
  /**
   * Percentile shoulder (rank in [0,1)) of the shaped elevation field that
   * range normalization remaps to 0. Default 0.02 (see NORMALIZATION NOTE).
   */
  elevationNormLow: number;
  /**
   * Percentile shoulder (rank in (0,1]) of the shaped elevation field that
   * range normalization remaps to 1. Default 0.99999 (see NORMALIZATION NOTE).
   */
  elevationNormHigh: number;
}

export const DEFAULT_FIELD_PARAMS: FieldParams = {
  elevationFreq: 3.5,
  elevationOctaves: 5,
  elevationLacunarity: 2.0,
  elevationGain: 0.5,
  redistribution: 1.5,
  falloffStrength: 0.0,
  moistureFreq: 2.5,
  moistureOctaves: 3,
  moistureLacunarity: 2.0,
  moistureGain: 0.5,
  moistureSeedOffset: 7919,
  elevationNormLow: 0.02,
  elevationNormHigh: 0.99999,
};

/**
 * CALIBRATION NOTE (falloffStrength). D1 commits to redistribution pow ~1.5
 * and D3 commits to sea level 0.40, but leaves the falloff strength tunable
 * ("medium confidence until tested against the actual noise distribution").
 * The pre-T3b value 0.03 was calibrated for the pre-normalization pipeline
 * (ocean 0.60–0.70 at redistribution 1.5 / sea level 0.40). T3c moves the
 * DEFAULT to 0.0: with percentile range normalization in place, even a mild
 * falloff measurably fattens the normalized snow tail (its d-gradient spreads
 * the top region's values apart, so the [0.88, 1] band catches more rank mass)
 * and re-inverts the snow/mountain ratio at some seeds. Island character is a
 * preset concern — the presets carry their own falloff overrides (continent
 * mild, archipelago strong), and manual slider terrain at falloff 0 differs
 * visually only in that the map rim is no longer nudged toward ocean.
 * T4's seaLevelBias knob remains the intended home for further tuning.
 */

export interface Fields {
  elevation: Float32Array; // [0,1] per pixel, row-major
  moisture: Float32Array; // [0,1] per pixel, row-major
  resolution: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Histogram bins for the percentile scan (resolution 1/4096 ≈ 0.00024). */
const NORMALIZATION_BINS = 4096;

/**
 * NORMALIZATION NOTE (T3b, recalibrated T3c). The pre-T3b pipeline ended at
 * the redistribution pow, whose output practically tops out near 0.84 (the fBm
 * (n+1)/2 mapping never approaches its theoretical 1.0, and any pow ≥ 1
 * compresses it further). Measured across all three presets × 8 seeds at 512²,
 * the max elevation ever produced was 0.859 — below the committed snow
 * threshold 0.88, leaving the mountain band a rounding-error sliver and
 * snow/tundra/taiga structurally unreachable. The fix is the range
 * normalization T3's spec asked for ("normalize [0,1]") implemented as a
 * percentile remap: stretch the shaped field so a percentile span maps to
 * [0, 1] (clamped at the shoulders). The low shoulder trims the
 * falloff-clamped rim (notably the archipelago's hard zero border).
 *
 * T3c moved the default top shoulder 0.9995 → 0.99999 (effectively "the true
 * max"): the T3b value clips a fat rank slice to exactly 1.0 and, more
 * importantly, leaves the [0.88, 1] snow band holding more mass than the
 * [0.80, 0.88] mountain band feeds its dry half (the mountain BIOME is only
 * the m < 0.5 half of the mountain band — see classify's
 * MOUNTAIN_MOISTURE_SPLIT), which inverted snow/mountain at most seeds.
 * Stretching to ~the max parks the extreme tail at the very top of [0,1] and
 * restores mountain ≥ snow; see the T3c production-log entry for the
 * measurement tables. The shoulders are pure functions of the generated field
 * (one histogram pass, no RNG, no cross-call state), so determinism per (seed,
 * params, resolution) is preserved; because the bounds are data-dependent per
 * resolution, a 256² drag preview can differ slightly from its 512² commit
 * frame (already approximate; see map-controller.ts preview path).
 */
export function normalizeElevationRange(field: Float32Array, lowRank: number, highRank: number): void {
  // Degenerate / garbage shoulder input: leave the shaped field untouched
  // (deterministic no-op rather than a NaN-poisoned output).
  if (!(lowRank >= 0) || !(highRank <= 1) || !(highRank - lowRank > 1e-6)) return;

  const n = field.length;
  const hist = new Uint32Array(NORMALIZATION_BINS);
  for (let i = 0; i < n; i++) {
    const bin = (field[i] * NORMALIZATION_BINS) | 0;
    // Values are shaped into [0,1]; the clamps below only guard float fuzz.
    hist[bin < 0 ? 0 : bin >= NORMALIZATION_BINS ? NORMALIZATION_BINS - 1 : bin]++;
  }

  const lowTarget = lowRank * n;
  const highTarget = highRank * n;
  // Smallest bin whose INCLUSIVE cumulative count exceeds the target rank —
  // the classic histogram quantile. Defaults cover the (impossible) no-break
  // case; rank 1 lands on the last non-empty bin by construction.
  let acc = 0;
  let lowBin = NORMALIZATION_BINS - 1;
  for (let b = 0; b < NORMALIZATION_BINS; b++) {
    if (acc + hist[b] > lowTarget) {
      lowBin = b;
      break;
    }
    acc += hist[b];
  }
  let highBin = NORMALIZATION_BINS - 1;
  for (let b = lowBin; b < NORMALIZATION_BINS; b++) {
    if (acc + hist[b] > highTarget) {
      highBin = b;
      break;
    }
    acc += hist[b];
  }

  // Bin centers as the percentile estimates (histogram resolution 1/4096).
  const low = (lowBin + 0.5) / NORMALIZATION_BINS;
  const high = (highBin + 0.5) / NORMALIZATION_BINS;
  if (!(high - low > 1e-6)) return;

  const scale = 1 / (high - low);
  for (let i = 0; i < n; i++) {
    field[i] = clamp01((field[i] - low) * scale);
  }
}

/**
 * Generates the elevation field alone for a `resolution × resolution` map.
 *
 * Elevation: fBm → [0,1] → island falloff (edges pushed to ocean) → power
 * redistribution (flattens lowlands, sharpens peaks) → percentile range
 * normalization (2nd percentile → 0, ~max → 1, clamped; see the
 * NORMALIZATION NOTE). Worker `recompute-elevation` requests (T5) call this
 * directly; `generateFields` reuses it internally so the elevation-only and
 * full-generation paths stay numerically identical by construction.
 */
export function generateElevation(seed: number, params: FieldParams, resolution: number): Float32Array {
  const elevationFbm = createFbm2D({
    octaves: params.elevationOctaves,
    lacunarity: params.elevationLacunarity,
    gain: params.elevationGain,
    baseFreq: params.elevationFreq,
    seed,
  });

  const elevation = new Float32Array(resolution * resolution);

  let i = 0;
  for (let y = 0; y < resolution; y++) {
    const ny = y / resolution - 0.5;
    const ey = 2 * ny; // edge coordinate, [-1, 1]
    const ey2 = ey * ey;
    for (let x = 0; x < resolution; x++) {
      const nx = x / resolution - 0.5;
      const ex = 2 * nx; // edge coordinate, [-1, 1]
      // Island falloff distance: 0 at the center, 1 along the map border.
      const d = 1 - (1 - ex * ex) * (1 - ey2);
      // Falloff subtraction, clamped before redistribution keeps e^r in [0, 1].
      const shaped = clamp01((elevationFbm(nx, ny) + 1) / 2 - params.falloffStrength * d);
      elevation[i] = shaped ** params.redistribution;
      i++;
    }
  }

  normalizeElevationRange(elevation, params.elevationNormLow, params.elevationNormHigh);

  return elevation;
}

/**
 * Generates elevation and moisture fields for a `resolution × resolution` map.
 *
 * Elevation is delegated to `generateElevation` (see above). Moisture: an
 * independently seeded, smoother fBm → [0,1] with no falloff — climate is not
 * island-shaped.
 *
 * The fBm factories are built once per call; the pixel loops perform no
 * allocations beyond the output arrays.
 */
export function generateFields(seed: number, params: FieldParams, resolution: number): Fields {
  const elevation = generateElevation(seed, params, resolution);

  const moistureFbm = createFbm2D({
    octaves: params.moistureOctaves,
    lacunarity: params.moistureLacunarity,
    gain: params.moistureGain,
    baseFreq: params.moistureFreq,
    seed: seed + params.moistureSeedOffset,
  });

  const moisture = new Float32Array(resolution * resolution);

  let i = 0;
  for (let y = 0; y < resolution; y++) {
    const ny = y / resolution - 0.5;
    for (let x = 0; x < resolution; x++) {
      const nx = x / resolution - 0.5;
      moisture[i] = clamp01((moistureFbm(nx, ny) + 1) / 2);
      i++;
    }
  }

  return { elevation, moisture, resolution };
}
