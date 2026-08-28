import { describe, it, expect } from 'vitest';
import { DEFAULT_FIELD_PARAMS, generateFields } from './fields.ts';
import { BIOME_IDS, classify } from './biomes.ts';
import type { BiomeId } from './biomes.ts';
import { PRESETS } from '../presets/presets.ts';
import type { FieldParams, Fields } from './fields.ts';

function mean(a: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return sum / a.length;
}

function minMax(a: Float32Array): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function countDiffering(a: Float32Array, b: Float32Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Pearson correlation of two equal-length arrays. */
function pearson(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    sa += x;
    sb += y;
    saa += x * x;
    sbb += y * y;
    sab += x * y;
  }
  const cov = sab / n - (sa / n) * (sb / n);
  const varA = saa / n - (sa / n) ** 2;
  const varB = sbb / n - (sb / n) ** 2;
  return cov / Math.sqrt(varA * varB);
}

describe('generateFields normalization', () => {
  it('every elevation and moisture value at 512 lies within [0, 1]', () => {
    const fields = generateFields(1, DEFAULT_FIELD_PARAMS, 512);
    const elev = minMax(fields.elevation);
    const moist = minMax(fields.moisture);
    // Report the actual spread alongside the hard bounds.
    console.log(
      `512 defaults — elevation [${elev.min.toFixed(4)}, ${elev.max.toFixed(4)}], ` +
        `moisture [${moist.min.toFixed(4)}, ${moist.max.toFixed(4)}]`,
    );
    expect(elev.min).toBeGreaterThanOrEqual(0);
    expect(elev.max).toBeLessThanOrEqual(1);
    expect(moist.min).toBeGreaterThanOrEqual(0);
    expect(moist.max).toBeLessThanOrEqual(1);
  });
});

describe('generateFields resolutions', () => {
  it('supports 256 (preview) and 512 (final) with matching lengths and resolution', () => {
    const preview = generateFields(7, DEFAULT_FIELD_PARAMS, 256);
    const final = generateFields(7, DEFAULT_FIELD_PARAMS, 512);
    expect(preview.elevation.length).toBe(256 * 256);
    expect(preview.moisture.length).toBe(256 * 256);
    expect(preview.resolution).toBe(256);
    expect(final.elevation.length).toBe(512 * 512);
    expect(final.moisture.length).toBe(512 * 512);
    expect(final.resolution).toBe(512);
  });
});

describe('generateFields default look', () => {
  it('ocean fraction at sea level 0.40 stays between 0.25 and 0.75', () => {
    const fields = generateFields(1, DEFAULT_FIELD_PARAMS, 512);
    let ocean = 0;
    for (let i = 0; i < fields.elevation.length; i++) {
      if (fields.elevation[i] < 0.40) ocean++;
    }
    const fraction = ocean / fields.elevation.length;
    console.log(`512 defaults — ocean fraction at sea level 0.40: ${fraction.toFixed(4)}`);
    expect(fraction).toBeGreaterThanOrEqual(0.25);
    expect(fraction).toBeLessThanOrEqual(0.75);
  });
});

describe('falloff parameter effect', () => {
  it('falloffStrength 1.0 yields lower mean elevation than falloffStrength 0', () => {
    const noFalloff = generateFields(5, { ...DEFAULT_FIELD_PARAMS, falloffStrength: 0 }, 256);
    const fullFalloff = generateFields(5, { ...DEFAULT_FIELD_PARAMS, falloffStrength: 1.0 }, 256);
    const meanNone = mean(noFalloff.elevation);
    const meanFull = mean(fullFalloff.elevation);
    console.log(`falloff mean elevation — 0: ${meanNone.toFixed(4)}, 1.0: ${meanFull.toFixed(4)}`);
    expect(meanFull).toBeLessThan(meanNone);
  });
});

describe('redistribution parameter effect', () => {
  it('redistribution 2.0 yields lower mean elevation than redistribution 1.0', () => {
    const linear = generateFields(5, { ...DEFAULT_FIELD_PARAMS, redistribution: 1.0 }, 256);
    const steep = generateFields(5, { ...DEFAULT_FIELD_PARAMS, redistribution: 2.0 }, 256);
    const meanLinear = mean(linear.elevation);
    const meanSteep = mean(steep.elevation);
    console.log(`redistribution mean elevation — 1.0: ${meanLinear.toFixed(4)}, 2.0: ${meanSteep.toFixed(4)}`);
    expect(meanSteep).toBeLessThan(meanLinear);
  });
});

describe('moisture decorrelation', () => {
  it('|Pearson(elevation, moisture)| < 0.3 at defaults (independent seeds)', () => {
    const fields = generateFields(1, DEFAULT_FIELD_PARAMS, 512);
    const correlation = pearson(fields.elevation, fields.moisture);
    console.log(`elevation/moisture Pearson correlation: ${correlation.toFixed(4)}`);
    expect(Math.abs(correlation)).toBeLessThan(0.3);
  });
});

describe('performance smoke', () => {
  it('generateFields at 512² completes well under 2s', () => {
    const t0 = performance.now();
    generateFields(1, DEFAULT_FIELD_PARAMS, 512);
    const elapsed = performance.now() - t0;
    console.log(`generateFields(512², defaults) wall time: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------
// T3b regression: dead upper biome bands. Before the percentile range
// normalization, the shaped field practically topped out at ~0.84–0.86, below
// the committed snow threshold 0.88 — mountain was a rounding-error sliver
// and snow/tundra/taiga were structurally unreachable through the real
// pipeline. These tests pin reachability through generateFields (not classify
// directly), so they fail if any future shaping change re-compresses the
// elevation range.
// ---------------------------------------------------------------------------

/** Controller's slider → params mapping (map-controller.ts, committed in T6). */
function controllerFieldParams(elevation: number, overrides: Record<string, number> = {}) {
  return {
    ...DEFAULT_FIELD_PARAMS,
    elevationFreq: 2.5 + 2 * elevation,
    redistribution: 1.2 + 0.6 * elevation,
    ...overrides,
  };
}

/** Controller's moisture slider → classification biases (±0.4 span). */
function moistureBiases(moisture: number) {
  return { seaLevelBias: 0, moistureBias: (moisture - 0.5) * 0.8 };
}

function biomeFractions(fields: Fields, biases: { seaLevelBias: number; moistureBias: number }) {
  const counts = new Map<BiomeId, number>();
  for (const id of BIOME_IDS) counts.set(id, 0);
  let land = 0;
  for (let i = 0; i < fields.elevation.length; i++) {
    if (fields.elevation[i] >= 0.4) land++;
    const id = classify(fields.elevation[i], fields.moisture[i], biases);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const n = fields.elevation.length;
  const fractions = {} as Record<BiomeId, number>;
  for (const id of BIOME_IDS) fractions[id] = (counts.get(id) ?? 0) / n;
  return { fractions, land: land / n };
}

describe('T3b biome reachability at defaults', () => {
  const SEEDS = [101, 202, 303, 404];

  it('every one of the 12 biomes appears (> 0) in every seed', () => {
    for (const seed of SEEDS) {
      const fields = generateFields(seed, DEFAULT_FIELD_PARAMS, 512);
      const { fractions } = biomeFractions(fields, moistureBiases(0.5));
      for (const id of BIOME_IDS) {
        expect(fractions[id], `seed ${seed}, ${id}`).toBeGreaterThan(0);
      }
    }
  });

  it('each biome holds ≥ 0.1% of the map on average across the sweep', () => {
    const acc = {} as Record<BiomeId, number>;
    let ocean = 0;
    for (const id of BIOME_IDS) acc[id] = 0;
    for (const seed of SEEDS) {
      const fields = generateFields(seed, DEFAULT_FIELD_PARAMS, 512);
      const { fractions } = biomeFractions(fields, moistureBiases(0.5));
      ocean += fractions.deepOcean + fractions.ocean;
      for (const id of BIOME_IDS) acc[id] += fractions[id] / SEEDS.length;
    }
    for (const id of BIOME_IDS) {
      expect(acc[id], `${id} mean fraction`).toBeGreaterThanOrEqual(0.001);
    }
    // Ocean band (pre-fix look was 0.60–0.70; committed sanity band 0.25–0.75).
    expect(ocean / SEEDS.length).toBeGreaterThanOrEqual(0.45);
    expect(ocean / SEEDS.length).toBeLessThanOrEqual(0.75);
    // Mountain clearly present, snow present but sparse.
    expect(acc.mountain).toBeGreaterThan(0.0005);
    expect(acc.snow).toBeGreaterThan(0);
    expect(acc.snow).toBeLessThan(0.02);
  });

  it('max elevation through the pipeline reaches into the snow band (> 0.88)', () => {
    for (const seed of SEEDS.slice(0, 2)) {
      const fields = generateFields(seed, DEFAULT_FIELD_PARAMS, 512);
      const { max } = minMax(fields.elevation);
      expect(max).toBeGreaterThan(0.88);
    }
  });
});

describe('T3b preset reachability (registry snapshots, controller merge)', () => {
  const highlands = PRESETS.find((p) => p.id === 'highlands')!;
  const archipelago = PRESETS.find((p) => p.id === 'archipelago')!;

  it('highlands: land ≥ 35%, mountain ≥ 2%, snow ≥ 0.5%, tundra ≥ 0.5%', () => {
    for (const seed of [7, 8]) {
      const params = controllerFieldParams(highlands.elevation, { ...highlands.overrides });
      const fields = generateFields(seed, params, 512);
      const { fractions, land } = biomeFractions(fields, moistureBiases(highlands.moisture));
      expect(land, `seed ${seed} land`).toBeGreaterThanOrEqual(0.35);
      expect(fractions.mountain, `seed ${seed} mountain`).toBeGreaterThanOrEqual(0.02);
      expect(fractions.snow, `seed ${seed} snow`).toBeGreaterThanOrEqual(0.005);
      expect(fractions.tundra, `seed ${seed} tundra`).toBeGreaterThanOrEqual(0.005);
    }
  });

  it('archipelago: island-scattered (land 3–15%) with mountains somewhere', () => {
    let landSum = 0;
    let mountainSum = 0;
    for (const seed of [5, 6]) {
      const params = controllerFieldParams(archipelago.elevation, { ...archipelago.overrides });
      const fields = generateFields(seed, params, 512);
      const { fractions, land } = biomeFractions(fields, moistureBiases(archipelago.moisture));
      expect(land, `seed ${seed} land`).toBeGreaterThanOrEqual(0.03);
      expect(land, `seed ${seed} land`).toBeLessThanOrEqual(0.15);
      landSum += land;
      mountainSum += fractions.mountain;
    }
    expect(mountainSum).toBeGreaterThan(0); // present somewhere in the sweep
  });
});

// T3b normalization determinism (same inputs → identical arrays at 256²) was
// folded into the T15 field-hash suite below when that suite pinned the same
// configuration (defaults, seed 9, 256²) to a recorded byte-level digest —
// strictly stronger coverage of the same invariant.

// ---------------------------------------------------------------------------
// T3c regression: snow/mountain ratio + land coherence. T3b's normalization
// made every biome reachable but left two defects, both measured at 512²:
// (a) RATIO INVERSION — the mountain BIOME is only the dry half of the
//     mountain elevation band (classify's MOUNTAIN_MOISTURE_SPLIT 0.5, and
//     the band's conditional dry share is ~0.38–0.44), while snow takes the
//     ENTIRE ≥ 0.88 region regardless of moisture; the old 0.9995 top
//     shoulder left enough mass above 0.88 that snow out-sized mountain at
//     most seeds. Fix: near-max default shoulder (0.9995 → 0.99999) + default
//     falloff 0.03 → 0 + preset recalibration (see presets.ts).
// (b) LAND FRAGMENTATION — continent/highlands largest 4-connected land
//     component was 37–68% / 26–67% of total land. Fix: preset-level
//     elevationFreq overrides (bigger features) + falloff + slider positions;
//     both presets now hold ≥ 55% at every seed.
// These tests pin both fixes through generateFields with the controller
// merge (the same param path the worker serves).
// ---------------------------------------------------------------------------

/** Largest 4-connected component of land (elevation ≥ sea level) / total land. */
function landCoherence(elev: Float32Array, resolution: number): number {
  const n = elev.length;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let land = 0;
  for (let i = 0; i < n; i++) if (elev[i] >= 0.4) land++;
  let best = 0;
  for (let i = 0; i < n; i++) {
    if (elev[i] < 0.4 || seen[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let size = 0;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const x = p % resolution;
      const y = (p / resolution) | 0;
      if (x > 0) { const q = p - 1; if (!seen[q] && elev[q] >= 0.4) { seen[q] = 1; stack[sp++] = q; } }
      if (x < resolution - 1) { const q = p + 1; if (!seen[q] && elev[q] >= 0.4) { seen[q] = 1; stack[sp++] = q; } }
      if (y > 0) { const q = p - resolution; if (!seen[q] && elev[q] >= 0.4) { seen[q] = 1; stack[sp++] = q; } }
      if (y < resolution - 1) { const q = p + resolution; if (!seen[q] && elev[q] >= 0.4) { seen[q] = 1; stack[sp++] = q; } }
    }
    if (size > best) best = size;
  }
  return land === 0 ? 0 : best / land;
}

describe('T3c snow/mountain ratio (snow caps mountains; never out-sizes them)', () => {
  // Includes each config's tightest measured seed (continent 0, highlands 7,
  // defaults 404) so the regression net sits on the real margin.
  const SEEDS = [0, 7, 12345, 404];
  const continent = PRESETS.find((p) => p.id === 'continent')!;
  const highlands = PRESETS.find((p) => p.id === 'highlands')!;

  it('defaults: snow ≤ mountain at every seed', () => {
    for (const seed of SEEDS) {
      const fields = generateFields(seed, DEFAULT_FIELD_PARAMS, 512);
      const { fractions } = biomeFractions(fields, moistureBiases(0.5));
      expect(fractions.snow, `seed ${seed} snow`).toBeLessThanOrEqual(fractions.mountain);
    }
  });

  it('continent + highlands (registry snapshots, controller merge): snow ≤ mountain at every seed', () => {
    for (const preset of [continent, highlands]) {
      for (const seed of SEEDS) {
        const params = controllerFieldParams(preset.elevation, { ...preset.overrides });
        const fields = generateFields(seed, params, 512);
        const { fractions } = biomeFractions(fields, moistureBiases(preset.moisture));
        expect(fractions.snow, `${preset.id} seed ${seed} snow`).toBeLessThanOrEqual(fractions.mountain);
      }
    }
  });

  it('archipelago: snow ≤ 0.5% at every seed (islets may be all cap — no mountain floor)', () => {
    const archipelago = PRESETS.find((p) => p.id === 'archipelago')!;
    for (const seed of SEEDS) {
      const params = controllerFieldParams(archipelago.elevation, { ...archipelago.overrides });
      const fields = generateFields(seed, params, 512);
      const { fractions } = biomeFractions(fields, moistureBiases(archipelago.moisture));
      expect(fractions.snow, `seed ${seed} snow`).toBeLessThanOrEqual(0.005);
    }
  });
});

describe('T3c land coherence (one dominant landmass for continent + highlands)', () => {
  // Flood-fill at 256²: during T3c the continent/highlands verdicts were
  // verified resolution-stable (128²/256²/512² within 0.4pp, identical
  // pass/fail), so the cheaper resolution is a faithful proxy for 512².
  // Seeds: 0 = continent's floor seed (55.8%); 404 = the seed where the
  // continent elevationFreq override actually pays off (F1, T3c-fix: without
  // the 2.72 override — slider-derived 3.1 at elevation 0.3 — s404 coherence
  // collapses to 47.8%, below the 55% floor; with it the preset holds).
  const SEEDS = [0, 42, 7, 12345, 404];
  const RES = 256;

  it('continent: largest 4-connected land component ≥ 55% of land at every seed', () => {
    const preset = PRESETS.find((p) => p.id === 'continent')!;
    for (const seed of SEEDS) {
      const params = controllerFieldParams(preset.elevation, { ...preset.overrides });
      const fields = generateFields(seed, params, RES);
      const coherence = landCoherence(fields.elevation, RES);
      expect(coherence, `seed ${seed} coherence`).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('highlands: largest 4-connected land component ≥ 55% of land at every seed', () => {
    const preset = PRESETS.find((p) => p.id === 'highlands')!;
    for (const seed of SEEDS) {
      const params = controllerFieldParams(preset.elevation, { ...preset.overrides });
      const fields = generateFields(seed, params, RES);
      const coherence = landCoherence(fields.elevation, RES);
      expect(coherence, `seed ${seed} coherence`).toBeGreaterThanOrEqual(0.55);
    }
  });
});

// ---------------------------------------------------------------------------
// T3c-fix boot config. A bare URL boots the continent preset's OWN snapshot
// (seed 0, slider 0.3 + overrides — app.ts `bareBootState`), so the
// first-load map IS the calibrated continent map instead of the old hybrid
// (preset overrides over centered 0.5/0.5 sliders: redistribution 1.5, which
// marginally inverted snow/mountain and missed the coherence floor at seed
// 0). The sweeps above already hold seed 0 for both presets; this states the
// boot acceptance invariants explicitly, at the verifier's 512² scale.
// ---------------------------------------------------------------------------

describe('T3c-fix boot config (bare URL = continent preset @ seed 0)', () => {
  it('boot map satisfies snow ≤ mountain and coherence ≥ 55% at 512²', () => {
    const preset = PRESETS.find((p) => p.id === 'continent')!;
    const params = controllerFieldParams(preset.elevation, { ...preset.overrides });
    const fields = generateFields(0, params, 512);
    const { fractions } = biomeFractions(fields, moistureBiases(preset.moisture));
    expect(fractions.snow, 'boot snow ≤ mountain').toBeLessThanOrEqual(fractions.mountain);
    const coherence = landCoherence(fields.elevation, 512);
    expect(coherence, 'boot coherence ≥ 55%').toBeGreaterThanOrEqual(0.55);
  });
});

// ---------------------------------------------------------------------------
// T15 determinism suite (plan lane E: "field-hash determinism"). The
// behavioral sweeps above pin WHAT the pipeline produces (fractions, ratios,
// coherence); this block pins the exact BYTES, closing the two gaps the
// verifiers logged: (F2, from T3b + T3c) no 512² normalization-on hash case
// existed — the pre-T15 determinism coverage was same-inputs-twice property
// tests at 128²/256² only, so a silent value drift (e.g. an octave changed, a
// reordered arithmetic op, an engine-sensitive rewrite) could pass every test
// in the file. The pinned digests below fail on ANY value change anywhere in
// either field. It also consolidates the two same-inputs-twice property tests
// this file had grown (the T3-era 128² one and T3b's 256² normalization one)
// into one grid: seed × params × resolution, with the runs also compared
// element-wise and under interleaved foreign generations (generation order
// must never leak state — the noise factories, permutation tables and
// normalization histogram are all per-call).
// ---------------------------------------------------------------------------

/**
 * Byte-level digest of one field: two independent 32-bit lanes (FNV-1a and a
 * murmur3-style mixer) folded over the raw Float32 bytes, printed as 16 hex
 * digits. Any single-bit change anywhere in the array alters the digest with
 * overwhelming probability (2⁻⁶⁴ collision odds per pair). The pipeline uses
 * only IEEE-754-exact operations (imul/floor/sqrt — no transcendentals), so
 * the digests are reproducible across JS engines on little-endian hardware
 * (every engine this suite targets).
 */
function fieldHash(field: Float32Array): string {
  const bytes = new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
  let h1 = 0x811c9dc5; // FNV-1a 32 offset basis
  let h2 = 0x9e3779b9; // golden-ratio seed for the second lane
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ b, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ (h2 >>> 13), 0xc2b2ae35) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** Digest of a full Fields pair — the moisture field is pinned alongside elevation. */
function fieldsHash(fields: Fields): string {
  return `e:${fieldHash(fields.elevation)} m:${fieldHash(fields.moisture)}`;
}

describe('T15 field-hash determinism (seed × params × resolution grid)', () => {
  const continent = PRESETS.find((p) => p.id === 'continent')!;
  const highlands = PRESETS.find((p) => p.id === 'highlands')!;

  // Four pins (the deliberate budget — each must earn a 512²/256² generate):
  //   1. defaults @ 512², seed 404 — normalization-on final-resolution case
  //      (F2); seed 404 is the defaults sweep's ratio-tightest seed.
  //   2. highlands preset merge @ 512², seed 7 — a preset config exercising
  //      the override knobs (freq 1.5, falloff 0.06, normHigh 0.997,
  //      moistureOctaves 4); seed 7 is highlands' ratio-tightest seed.
  //   3. bare-boot continent merge @ 512², seed 0 — the first-load map's
  //      exact bytes (the config the T3c-fix boot test pins behaviorally).
  //   4. defaults @ 256², seed 9 — the preview resolution; same configuration
  //      the removed T3b 256² property test used.
  const HASH_PINS: ReadonlyArray<{
    label: string;
    seed: number;
    params: FieldParams;
    resolution: number;
    hash: string;
  }> = [
    {
      label: 'defaults @ 512², seed 404',
      seed: 404,
      params: DEFAULT_FIELD_PARAMS,
      resolution: 512,
      hash: 'e:0b4517dcec50057f m:c9071afb9ed63a16',
    },
    {
      label: 'highlands preset merge @ 512², seed 7',
      seed: 7,
      params: controllerFieldParams(highlands.elevation, { ...highlands.overrides }),
      resolution: 512,
      hash: 'e:783fc69e15645ad6 m:66e1b07db81a9ccf',
    },
    {
      label: 'bare-boot continent merge @ 512², seed 0',
      seed: 0,
      params: controllerFieldParams(continent.elevation, { ...continent.overrides }),
      resolution: 512,
      hash: 'e:0e27b278c5e9c812 m:f70138fe372f43c4',
    },
    {
      label: 'defaults @ 256² (preview res), seed 9',
      seed: 9,
      params: DEFAULT_FIELD_PARAMS,
      resolution: 256,
      hash: 'e:d2e64633e148ac3a m:6a17f983e96c9842',
    },
  ];

  it('reproduces the pinned byte-level digests (elevation AND moisture) for every grid case', () => {
    for (const pin of HASH_PINS) {
      const fields = generateFields(pin.seed, pin.params, pin.resolution);
      const actual = fieldsHash(fields);
      expect(actual, `${pin.label} digest changed`).toBe(pin.hash);
    }
  });

  it('same inputs reproduce element-wise, with foreign generations interleaved between the runs', () => {
    const pin = HASH_PINS[3]; // defaults @ 256² — the preview-resolution slot
    const first = generateFields(pin.seed, pin.params, pin.resolution);

    // Interleave maximally different work between the two A-runs: different
    // seed, different params (both preset merges), different resolution. A
    // generation of config B must leave no trace in a later generation of
    // config A (no shared mutable state anywhere in the pipeline).
    const foreignBoot = generateFields(
      0,
      controllerFieldParams(continent.elevation, { ...continent.overrides }),
      512,
    );
    const foreignHighlands = generateFields(
      7,
      controllerFieldParams(highlands.elevation, { ...highlands.overrides }),
      512,
    );
    expect(foreignBoot.resolution).toBe(512);
    expect(foreignHighlands.resolution).toBe(512);

    const second = generateFields(pin.seed, pin.params, pin.resolution);
    expect(countDiffering(first.elevation, second.elevation)).toBe(0);
    expect(countDiffering(first.moisture, second.moisture)).toBe(0);
    // Both runs also match the pinned digest — run-to-run AND
    // recorded-reference equality, in one place.
    expect(fieldsHash(first)).toBe(pin.hash);
    expect(fieldsHash(second)).toBe(pin.hash);
  });

  it('different seed changes both fields (at least 10% of elements differ)', () => {
    const seedA = generateFields(123, DEFAULT_FIELD_PARAMS, 128);
    const seedB = generateFields(124, DEFAULT_FIELD_PARAMS, 128);
    const n = seedA.elevation.length;
    expect(countDiffering(seedA.elevation, seedB.elevation) / n).toBeGreaterThanOrEqual(0.1);
    expect(countDiffering(seedA.moisture, seedB.moisture) / n).toBeGreaterThanOrEqual(0.1);
  });
});
