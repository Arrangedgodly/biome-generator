import { describe, it, expect } from 'vitest';
import {
  BIOME_IDS,
  BIOMES,
  NO_BIASES,
  classify,
  type BiomeId,
  type ClassifyBiases,
} from './biomes.ts';

const EPS = 1e-9;
const REPRESENTATIVE_MOISTURES = [0.1, 0.4, 0.6, 0.9] as const;

/**
 * Expected biome per elevation band × representative moisture, transcribed
 * literally from the D3 table (not derived from `classify`): water/beach/snow
 * ignore moisture; lowland, highland, and mountain rows follow the moisture
 * columns 0.1 / 0.4 / 0.6 / 0.9.
 */
type BandKey =
  | 'below28'
  | 'oceanBand'
  | 'beachBand'
  | 'lowland'
  | 'highland'
  | 'mountainBand'
  | 'snowBand';
const EXPECTED_BY_BAND: Record<BandKey, readonly [BiomeId, BiomeId, BiomeId, BiomeId]> = {
  below28: ['deepOcean', 'deepOcean', 'deepOcean', 'deepOcean'],
  oceanBand: ['ocean', 'ocean', 'ocean', 'ocean'],
  beachBand: ['beach', 'beach', 'beach', 'beach'],
  lowland: ['desert', 'savanna', 'grassland', 'rainforest'],
  highland: ['tundra', 'grassland', 'forest', 'taiga'],
  mountainBand: ['mountain', 'mountain', 'tundra', 'tundra'],
  snowBand: ['snow', 'snow', 'snow', 'snow'],
};

// Bands are lower-inclusive: at the boundary itself the higher band wins.
const ELEVATION_BOUNDARIES: ReadonlyArray<{ boundary: number; below: BandKey; atOrAbove: BandKey }> =
  [
    { boundary: 0.28, below: 'below28', atOrAbove: 'oceanBand' },
    { boundary: 0.4, below: 'oceanBand', atOrAbove: 'beachBand' },
    { boundary: 0.46, below: 'beachBand', atOrAbove: 'lowland' },
    { boundary: 0.66, below: 'lowland', atOrAbove: 'highland' },
    { boundary: 0.8, below: 'highland', atOrAbove: 'mountainBand' },
    { boundary: 0.88, below: 'mountainBand', atOrAbove: 'snowBand' },
  ];

describe('classify elevation boundary matrix (lower-inclusive bands)', () => {
  for (const { boundary, below, atOrAbove } of ELEVATION_BOUNDARIES) {
    describe(`elevation boundary ${boundary}`, () => {
      const probes: ReadonlyArray<{ label: string; e: number; band: BandKey }> = [
        { label: 'boundary − 1e-9', e: boundary - EPS, band: below },
        { label: 'exactly at boundary', e: boundary, band: atOrAbove },
        { label: 'boundary + 1e-9', e: boundary + EPS, band: atOrAbove },
      ];
      for (const { label, e, band } of probes) {
        it(`${label} matches the D3 table at every representative moisture`, () => {
          REPRESENTATIVE_MOISTURES.forEach((m, i) => {
            expect(classify(e, m)).toBe(EXPECTED_BY_BAND[band][i]);
          });
        });
      }
    });
  }
});

describe('classify moisture boundary matrix', () => {
  // [elevation, moisture boundary, biome just below, biome at/above]
  const cases: ReadonlyArray<[number, number, BiomeId, BiomeId]> = [
    // Lowland band (0.46 ≤ e < 0.66)
    [0.55, 0.25, 'desert', 'savanna'],
    [0.55, 0.5, 'savanna', 'grassland'],
    [0.55, 0.75, 'grassland', 'rainforest'],
    // Highland band (0.66 ≤ e < 0.80)
    [0.75, 0.25, 'tundra', 'grassland'],
    [0.75, 0.5, 'grassland', 'forest'],
    [0.75, 0.75, 'forest', 'taiga'],
    // Mountain band (0.80 ≤ e < 0.88): Mountain vs Tundra split
    [0.85, 0.5, 'mountain', 'tundra'],
  ];
  for (const [e, mb, below, atOrAbove] of cases) {
    it(`e=${e}: m=${mb} − 1e-9 → ${below}; m=${mb} and above → ${atOrAbove}`, () => {
      expect(classify(e, mb - EPS)).toBe(below);
      expect(classify(e, mb)).toBe(atOrAbove);
      expect(classify(e, mb + EPS)).toBe(atOrAbove);
    });
  }
});

describe('all 12 biomes reachable', () => {
  it('a 0..1 grid at step 0.01 classifies into exactly the committed biome set', () => {
    const seen = new Set<BiomeId>();
    for (let i = 0; i <= 100; i++) {
      for (let j = 0; j <= 100; j++) {
        seen.add(classify(i / 100, j / 100));
      }
    }
    expect([...seen].sort()).toEqual([...BIOME_IDS].sort());
  });
});

describe('classify biases shift classification', () => {
  it('e=0.40, m=0.5: no bias → Beach; seaLevelBias −0.05 → Ocean; +0.07 → Grassland', () => {
    expect(classify(0.4, 0.5, NO_BIASES)).toBe('beach');
    // Sea level rises: the shoreline moves inland, this pixel drowns.
    expect(classify(0.4, 0.5, { seaLevelBias: -0.05, moistureBias: 0 })).toBe('ocean');
    // Land rises out of the beach into the lowland band (m=0.5 → Grassland).
    expect(classify(0.4, 0.5, { seaLevelBias: 0.07, moistureBias: 0 })).toBe('grassland');
  });

  it('e=0.55, m=0.24 (Desert edge) with moistureBias +0.02 → Savanna', () => {
    expect(classify(0.55, 0.24)).toBe('desert');
    expect(classify(0.55, 0.24, { seaLevelBias: 0, moistureBias: 0.02 })).toBe('savanna');
  });

  it('extreme inputs with ±0.5 biases always produce a valid BiomeId', () => {
    const extremes = [-0.2, 0, 0.5, 1, 1.2];
    const valid = new Set<string>(BIOME_IDS);
    const bigBiases: ClassifyBiases[] = [
      { seaLevelBias: -0.5, moistureBias: -0.5 },
      { seaLevelBias: -0.5, moistureBias: 0.5 },
      { seaLevelBias: 0.5, moistureBias: -0.5 },
      { seaLevelBias: 0.5, moistureBias: 0.5 },
    ];
    for (const e of extremes) {
      for (const m of extremes) {
        for (const biases of bigBiases) {
          expect(valid.has(classify(e, m, biases))).toBe(true);
        }
      }
    }
  });
});

describe('palette luminance constants (WCAG 2.2)', () => {
  /** WCAG 2.2 relative luminance: linearize each sRGB channel, weighted sum. */
  function wcagLuminance(hex: string): number {
    const channel = (start: number): number => parseInt(hex.slice(start, start + 2), 16) / 255;
    const linearize = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return (
      0.2126 * linearize(channel(1)) +
      0.7152 * linearize(channel(3)) +
      0.0722 * linearize(channel(5))
    );
  }

  it('every stored luminance matches recomputation from its hex to 3 decimals', () => {
    for (const id of BIOME_IDS) {
      const { hex, luminance } = BIOMES[id];
      expect(luminance).toBeCloseTo(wcagLuminance(hex), 3);
    }
  });

  it('BIOMES covers exactly the committed 12 ids with matching name/id', () => {
    expect(Object.keys(BIOMES).sort()).toEqual([...BIOME_IDS].sort());
    for (const id of BIOME_IDS) {
      expect(BIOMES[id].id).toBe(id);
    }
  });
});
