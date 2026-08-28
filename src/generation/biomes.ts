/**
 * Biome classification (research D3, docs/ultron/research/rq3-biome-palette.md):
 * elevation-first ordered rules over shared moisture bands, sea level 0.40.
 * Pure data + pure function — no DOM, no rendering (the color LUT is T7's job;
 * palette-luminance adjacency testing is T9's).
 */

export const BIOME_IDS = [
  'deepOcean',
  'ocean',
  'beach',
  'desert',
  'savanna',
  'grassland',
  'rainforest',
  'tundra',
  'forest',
  'taiga',
  'mountain',
  'snow',
] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

export interface BiomeInfo {
  id: BiomeId;
  /** Display name, RPG-flavored but clear. */
  name: string;
  /** Committed palette color (research D3). */
  hex: string;
  /** WCAG 2.2 relative luminance of hex (precomputed constant, verified by test). */
  luminance: number;
}

export const BIOMES: Record<BiomeId, BiomeInfo> = {
  deepOcean: { id: 'deepOcean', name: 'Deep Ocean', hex: '#0b1a2c', luminance: 0.01 },
  ocean: { id: 'ocean', name: 'Ocean', hex: '#20658c', luminance: 0.115 },
  beach: { id: 'beach', name: 'Beach', hex: '#e9dca9', luminance: 0.714 },
  desert: { id: 'desert', name: 'Desert', hex: '#d2a24c', luminance: 0.401 },
  savanna: { id: 'savanna', name: 'Savanna', hex: '#87804a', luminance: 0.211 },
  grassland: { id: 'grassland', name: 'Grassland', hex: '#7ba95c', luminance: 0.334 },
  rainforest: { id: 'rainforest', name: 'Rainforest', hex: '#236639', luminance: 0.102 },
  tundra: { id: 'tundra', name: 'Tundra', hex: '#c8ceab', luminance: 0.594 },
  forest: { id: 'forest', name: 'Forest', hex: '#2f7239', luminance: 0.129 },
  taiga: { id: 'taiga', name: 'Taiga', hex: '#58919b', luminance: 0.247 },
  mountain: { id: 'mountain', name: 'Mountain', hex: '#bcb2a0', luminance: 0.451 },
  snow: { id: 'snow', name: 'Snow', hex: '#f3f6f6', luminance: 0.916 },
};

/**
 * T9 tunable knob (research D3): a darker beach for viewers who find the
 * default foreshore flash jarring. NOT applied by default — the committed
 * palette keeps `BIOMES.beach.hex`; swap this constant in at the color layer
 * if the knob is ever turned on. WCAG luminance ≈ 0.575 (vs default 0.714);
 * the full ΔL ≥ 0.08 adjacency suite passes with either beach (tested in
 * `biome-palette.test.ts`).
 */
export const BEACH_ALTERNATE_HEX = '#d8c790';

/**
 * Tunable band thresholds (research D3 committed values; T12 presets / T6
 * biases may shift classification at call time — these constants stay).
 */
export const ELEVATION_BANDS = {
  deepOceanMax: 0.28,
  seaLevel: 0.4, // ocean/beach boundary = committed sea level
  beachMax: 0.46,
  lowlandMax: 0.66,
  highlandMax: 0.8,
  mountainMax: 0.88, // at/above → Snow
} as const;

export const MOISTURE_BANDS = { semiArid: 0.25, humid: 0.5, wet: 0.75 } as const;

export const MOUNTAIN_MOISTURE_SPLIT = 0.5; // Mountain vs Tundra within the mountain band

export interface ClassifyBiases {
  /** Shifts elevation before banding (positive = more land). Default 0. */
  seaLevelBias: number;
  /** Shifts moisture before banding (positive = wetter). Default 0. */
  moistureBias: number;
}

export const NO_BIASES: ClassifyBiases = { seaLevelBias: 0, moistureBias: 0 };

/**
 * Elevation-first biome classification (research D3 crosswalk). Pure.
 *
 * Biases are applied to the inputs before banding, with no clamping: every
 * comparison is an ordered rule, so out-of-range inputs simply fall into the
 * outermost band (below Deep Ocean, at/above Snow, driest/wettest column).
 * Bands are lower-inclusive: e = seaLevel classifies as Beach, m = 0.25 as
 * the wetter column.
 */
export function classify(e: number, m: number, biases: ClassifyBiases = NO_BIASES): BiomeId {
  const ee = e + biases.seaLevelBias;
  const mm = m + biases.moistureBias;

  if (ee < ELEVATION_BANDS.deepOceanMax) return 'deepOcean';
  if (ee < ELEVATION_BANDS.seaLevel) return 'ocean';
  if (ee < ELEVATION_BANDS.beachMax) return 'beach';
  if (ee < ELEVATION_BANDS.lowlandMax) {
    // Lowland: Desert · Savanna · Grassland · Rainforest
    if (mm < MOISTURE_BANDS.semiArid) return 'desert';
    if (mm < MOISTURE_BANDS.humid) return 'savanna';
    if (mm < MOISTURE_BANDS.wet) return 'grassland';
    return 'rainforest';
  }
  if (ee < ELEVATION_BANDS.highlandMax) {
    // Highland: Tundra · Grassland · Forest · Taiga
    if (mm < MOISTURE_BANDS.semiArid) return 'tundra';
    if (mm < MOISTURE_BANDS.humid) return 'grassland';
    if (mm < MOISTURE_BANDS.wet) return 'forest';
    return 'taiga';
  }
  if (ee < ELEVATION_BANDS.mountainMax) {
    // Mountain band: Mountain (dry) / Tundra (wet)
    return mm < MOUNTAIN_MOISTURE_SPLIT ? 'mountain' : 'tundra';
  }
  return 'snow';
}
