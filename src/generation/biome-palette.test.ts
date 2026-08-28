//
// Palette-luminance test suite (plan T9; research D3,
// docs/ultron/research/rq3-biome-palette.md).
//
// Proves the D3 claims on the committed palette, computed from the hex values
// (not the stored constants, which T4 already guards):
//   1. ΔL ≥ 0.08 for every pair of biomes that can touch (the 20
//      table-adjacent pairs of the D3 crosswalk).
//   2. The same pairs keep ΔL ≥ 0.08 under Machado et al. (2009) deuteranopia
//      simulation, severity 1.0 — the matrix is transcribed from the authors'
//      published simulation-matrices table (full precision).
//   3. Structural CVD properties: no red-dominant color; the five green-family
//      biomes sit on the green→cyan hue arc, never near red.
//   4. Grayscale ordering: water darkest → snow brightest; beach flashes
//      brighter than ocean (foreshore sliver).
//   5. The optional Beach knob (#d8c790) keeps every adjacency pair legal and
//      does not change the default beach color.
import { describe, expect, it } from 'vitest';
import { BIOME_IDS, BIOMES, BEACH_ALTERNATE_HEX, classify, type BiomeId } from './biomes.ts';

const MIN_DELTA_L = 0.08;

// ---------------------------------------------------------------------------
// Color math (WCAG 2.2 relative luminance, recomputed from hex like T4's test)
// ---------------------------------------------------------------------------

type LinearRgb = readonly [number, number, number];

function hexToSrgbChannels(hex: string): LinearRgb {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function linearizeChannel(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToLinear(hex: string): LinearRgb {
  const [r, g, b] = hexToSrgbChannels(hex);
  return [linearizeChannel(r), linearizeChannel(g), linearizeChannel(b)];
}

function luminanceOfLinear([r, g, b]: LinearRgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 relative luminance of a #rrggbb hex. */
function wcagLuminance(hex: string): number {
  return luminanceOfLinear(hexToLinear(hex));
}

/** HSL-style hue angle in degrees [0, 360) of a #rrggbb hex. */
function hueDegrees(hex: string): number {
  const [r, g, b] = hexToSrgbChannels(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return (h + 360) % 360;
}

// ---------------------------------------------------------------------------
// Deuteranopia simulation — Machado, Oliveira & Fernandes 2009, severity 1.0
// ("A physiologically-based model for simulation of color vision deficiency",
// IEEE TVCG 15(6); matrix from the authors' published simulation tables).
// Applied to LINEAR RGB (per the paper); luminance is then read straight off
// the simulated linear channels (WCAG luminance is itself a linear-RGB
// weighted sum, so no re-encode to sRGB is needed).
// ---------------------------------------------------------------------------

type ReadonlyMatrix3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

const DEUTERANOPIA_SEVERITY_1: ReadonlyMatrix3 = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function deuteranopiaLuminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  const m = DEUTERANOPIA_SEVERITY_1;
  const sim: LinearRgb = [
    clamp01(m[0][0] * r + m[0][1] * g + m[0][2] * b),
    clamp01(m[1][0] * r + m[1][1] * g + m[1][2] * b),
    clamp01(m[2][0] * r + m[2][1] * g + m[2][2] * b),
  ];
  return luminanceOfLinear(sim);
}

// ---------------------------------------------------------------------------
// The D3 adjacency set: the 20 biome pairs that can touch on the crosswalk
// table (within-row moisture neighbors + vertical band transitions). The
// literal list below is transcribed from the research table; a derivation
// test re-derives it from `classify` over the band×column grid so a
// transcription slip cannot hide.
// ---------------------------------------------------------------------------

const ADJACENT_PAIRS: ReadonlyArray<readonly [BiomeId, BiomeId]> = [
  // Within-row moisture neighbors: lowland row, highland row, mountain split.
  ['desert', 'savanna'],
  ['savanna', 'grassland'],
  ['grassland', 'rainforest'],
  ['tundra', 'grassland'],
  ['grassland', 'forest'],
  ['forest', 'taiga'],
  ['mountain', 'tundra'],
  // Vertical band transitions at fixed representative moistures.
  ['deepOcean', 'ocean'],
  ['ocean', 'beach'],
  ['beach', 'desert'],
  ['beach', 'savanna'],
  ['beach', 'grassland'],
  ['beach', 'rainforest'],
  ['desert', 'tundra'],
  ['rainforest', 'taiga'],
  ['grassland', 'mountain'],
  ['forest', 'tundra'],
  ['taiga', 'tundra'],
  ['mountain', 'snow'],
  ['tundra', 'snow'],
];

const pairKey = (a: BiomeId, b: BiomeId): string => [a, b].sort().join(' | ');

/** One elevation-band center per row of the D3 crosswalk (7 bands). */
const BAND_CENTERS = [0.14, 0.34, 0.43, 0.56, 0.73, 0.84, 0.94] as const;
/** Column centers of the four shared moisture bands. */
const COLUMN_MOISTURES = [0.125, 0.375, 0.625, 0.875] as const;

function deriveAdjacentPairsFromTable(): Set<string> {
  const grid: BiomeId[][] = BAND_CENTERS.map((e) => [...COLUMN_MOISTURES].map((m) => classify(e, m)));
  const derived = new Set<string>();
  for (const row of grid) {
    for (let j = 0; j + 1 < row.length; j++) {
      if (row[j] !== row[j + 1]) derived.add(pairKey(row[j], row[j + 1]));
    }
  }
  for (let i = 0; i + 1 < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (grid[i][j] !== grid[i + 1][j]) derived.add(pairKey(grid[i][j], grid[i + 1][j]));
    }
  }
  return derived;
}

// ---------------------------------------------------------------------------
// Palette variants: the committed defaults + the optional Beach knob.
// ---------------------------------------------------------------------------

type Palette = Record<BiomeId, string>;

const defaultPalette: Palette = Object.fromEntries(
  BIOME_IDS.map((id) => [id, BIOMES[id].hex]),
) as Palette;

const beachAlternatePalette: Palette = { ...defaultPalette, beach: BEACH_ALTERNATE_HEX };

/** Collects every adjacency pair whose luminance gap is below the D3 rule. */
function pairsBelowDeltaL(palette: Palette, luminance: (hex: string) => number): string[] {
  const failures: string[] = [];
  for (const [a, b] of ADJACENT_PAIRS) {
    const dL = Math.abs(luminance(palette[a]) - luminance(palette[b]));
    if (dL < MIN_DELTA_L) failures.push(`${a}–${b} ΔL=${dL.toFixed(3)}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('D3 adjacency set', () => {
  it('the 20 transcribed table-adjacent pairs match a derivation from classify over the crosswalk grid', () => {
    expect(ADJACENT_PAIRS).toHaveLength(20);
    const literal = new Set(ADJACENT_PAIRS.map(([a, b]) => pairKey(a, b)));
    expect(literal.size).toBe(20); // no duplicates
    const derived = deriveAdjacentPairsFromTable();
    expect([...derived].sort()).toEqual([...literal].sort());
  });
});

describe('ΔL ≥ 0.08 across the adjacency set (normal vision)', () => {
  it('committed default palette: every adjacent pair passes', () => {
    const failures = pairsBelowDeltaL(defaultPalette, wcagLuminance);
    expect(failures, `pairs below ΔL ${MIN_DELTA_L}: ${failures.join('; ')}`).toEqual([]);
  });

  it('beach-alternate palette (#d8c790 knob): every adjacent pair still passes', () => {
    const failures = pairsBelowDeltaL(beachAlternatePalette, wcagLuminance);
    expect(failures, `pairs below ΔL ${MIN_DELTA_L}: ${failures.join('; ')}`).toEqual([]);
  });
});

describe('deuteranopia simulation (Machado 2009, severity 1.0)', () => {
  it('every matrix row sums to 1 (grays are invariant — transcription guard)', () => {
    for (const row of DEUTERANOPIA_SEVERITY_1) {
      expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 5);
    }
    // White maps to white (luminance preserved on the neutral axis, within
    // the published matrix's ~1e-6 rounding).
    expect(deuteranopiaLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('committed default palette: every adjacent pair keeps ΔL ≥ 0.08', () => {
    const failures = pairsBelowDeltaL(defaultPalette, deuteranopiaLuminance);
    expect(failures, `pairs below ΔL ${MIN_DELTA_L}: ${failures.join('; ')}`).toEqual([]);
  });

  it('beach-alternate palette: every adjacent pair keeps ΔL ≥ 0.08', () => {
    const failures = pairsBelowDeltaL(beachAlternatePalette, deuteranopiaLuminance);
    expect(failures, `pairs below ΔL ${MIN_DELTA_L}: ${failures.join('; ')}`).toEqual([]);
  });
});

describe('structural CVD properties', () => {
  it('no red-dominant color: the red channel is under 55% of the channel sum for every biome', () => {
    // Pure reds/oranges have a red share ≥ ~0.56–1.0; every palette color
    // (tans, sands, grays, blues, greens) stays well under 0.55 — the palette
    // never encodes meaning on the red-green hue axis via warm reds.
    for (const id of BIOME_IDS) {
      const [r, g, b] = hexToSrgbChannels(BIOMES[id].hex);
      const redShare = r / (r + g + b);
      expect(redShare, `${id} red share ${redShare.toFixed(3)}`).toBeLessThan(0.55);
    }
  });

  it('the five green-family biomes sit on the green→cyan hue arc (45°–200°), never near red', () => {
    // D3's "five green-family biomes separated purely by lightness": their
    // measured hue spread is ~137° (savanna 52° … taiga 189°), so a literal
    // ±40°-hue-window check would misstate the palette. What deuteranopes
    // actually rely on is (a) no reds anywhere (previous test) and (b)
    // adjacency-scoped luminance separation (suite above). This test pins the
    // structural half: all five hues stay inside the green→cyan arc.
    const greenFamily: readonly BiomeId[] = ['savanna', 'grassland', 'rainforest', 'forest', 'taiga'];
    for (const id of greenFamily) {
      const hue = hueDegrees(BIOMES[id].hex);
      expect(hue, `${id} hue ${hue.toFixed(1)}°`).toBeGreaterThanOrEqual(45);
      expect(hue, `${id} hue ${hue.toFixed(1)}°`).toBeLessThanOrEqual(200);
    }
  });
});

describe('grayscale ordering (water darkest → snow brightest)', () => {
  const L = (id: BiomeId): number => wcagLuminance(defaultPalette[id]);
  const mean = (ids: readonly BiomeId[]): number =>
    ids.reduce((sum, id) => sum + L(id), 0) / ids.length;

  it('deepOcean < ocean < lowland mean < highland mean < mountain-band mean < snow', () => {
    const lowlandMean = mean(['desert', 'savanna', 'grassland', 'rainforest']);
    const highlandMean = mean(['tundra', 'grassland', 'forest', 'taiga']);
    // Mountain band cells: Mountain (m < 0.5) and Tundra (m ≥ 0.5).
    const mountainBandMean = mean(['mountain', 'tundra']);
    expect(L('deepOcean')).toBeLessThan(L('ocean'));
    expect(L('ocean')).toBeLessThan(lowlandMean);
    expect(lowlandMean).toBeLessThan(highlandMean);
    expect(highlandMean).toBeLessThan(mountainBandMean);
    expect(mountainBandMean).toBeLessThan(L('snow'));
  });

  it('beach is brighter than ocean in both palette variants (foreshore flash)', () => {
    expect(wcagLuminance(defaultPalette.beach)).toBeGreaterThan(wcagLuminance(defaultPalette.ocean));
    expect(wcagLuminance(beachAlternatePalette.beach)).toBeGreaterThan(
      wcagLuminance(beachAlternatePalette.ocean),
    );
  });
});

describe('BEACH_ALTERNATE_HEX knob (T9 tunable constant)', () => {
  it('has WCAG luminance ≈ 0.57 (research D3: darker than the default 0.714)', () => {
    expect(Math.abs(wcagLuminance(BEACH_ALTERNATE_HEX) - 0.57)).toBeLessThanOrEqual(0.01);
  });

  it('does not change the committed default: BIOMES.beach stays #e9dca9 and differs from the knob', () => {
    expect(BIOMES.beach.hex).toBe('#e9dca9');
    expect(BEACH_ALTERNATE_HEX).not.toBe(BIOMES.beach.hex);
    expect(BEACH_ALTERNATE_HEX).toMatch(/^#[0-9a-f]{6}$/);
  });
});
