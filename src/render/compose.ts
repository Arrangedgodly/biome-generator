/**
 * Pure pixel-composition layer for the canvas renderer (plan T7, research D2
 * `docs/ultron/research/rq2-resolution-performance.md`).
 *
 * Strategy per D2: classify via an elevation×moisture palette LUT (never
 * per-pixel rule chains), keep alpha 255 everywhere (opaque fast path), and
 * compose in row-chunks small enough to fit a <8ms task budget. This module
 * is DOM-free and fully node-testable; blitting lives in `renderer.ts`.
 */

import { BIOMES, classify, NO_BIASES } from '../generation/biomes.ts';
import type { BiomeId, ClassifyBiases } from '../generation/biomes.ts';
import type { Fields } from '../generation/fields.ts';

export type RenderMode = 'elevation' | 'moisture' | 'biomes';

/** All render modes, in staged-animation order (Elevation → Moisture → Biomes). */
export const RENDER_MODES: readonly RenderMode[] = ['elevation', 'moisture', 'biomes'];

/** Default biome LUT granularity per axis: 64×64 = 4096 cells. */
export const LUT_STEPS = 64;

/**
 * One-time endianness probe (D2): write a Uint32 1, read the first byte.
 * ImageData memory layout is [r, g, b, a] per pixel regardless of platform;
 * the packed word that produces that layout differs by byte order.
 */
const ENDIAN_PROBE = new Uint32Array(1);
const ENDIAN_PROBE_BYTES = new Uint8Array(ENDIAN_PROBE.buffer);
ENDIAN_PROBE[0] = 1;
const IS_LITTLE_ENDIAN = ENDIAN_PROBE_BYTES[0] === 1;

/**
 * Packs (r, g, b, a=255) into the Uint32 word that, stored in the platform's
 * byte order, lands as [r, g, b, 255] in ImageData memory. Alpha is always
 * 255 (D2 opaque fast path). Result is unsigned so comparisons against
 * Uint32Array reads are exact.
 */
export function packRGBA(r: number, g: number, b: number): number {
  return IS_LITTLE_ENDIAN
    ? (r | (g << 8) | (b << 16) | (255 << 24)) >>> 0
    : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;
}

/** Quantizes a [0, 1] value to a LUT step index (top bin saturates). */
export function quantizeToStep(v: number, steps: number = LUT_STEPS): number {
  return Math.min(steps - 1, Math.floor(v * steps));
}

/** Center value of LUT bin `step` — the representative `classify` sees at build time. */
export function stepCenter(step: number, steps: number = LUT_STEPS): number {
  return (step + 0.5) / steps;
}

/** Parses a `#rrggbb` hex string into RGB channels. */
function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Packed-color cache per biome id — each hex is parsed exactly once. */
const packedBiomeColors = new Map<BiomeId, number>();

function packedBiomeColor(id: BiomeId): number {
  let packed = packedBiomeColors.get(id);
  if (packed === undefined) {
    const [r, g, b] = hexToRgb(BIOMES[id].hex);
    packed = packRGBA(r, g, b);
    packedBiomeColors.set(id, packed);
  }
  return packed;
}

/**
 * Builds the quantized elevation×moisture → packed biome color LUT
 * (`lut[eStep * steps + mStep]`). Each cell classifies its bin center, so the
 * LUT is exactly `classify` evaluated on the quantized grid. Biases are baked
 * in at build time: rebuilding this table and recomposing IS the moisture
 * slider's instant reclassification path (no noise, no worker).
 */
export function buildBiomeLut(biases: ClassifyBiases = NO_BIASES, steps: number = LUT_STEPS): Uint32Array {
  const lut = new Uint32Array(steps * steps);
  for (let eStep = 0; eStep < steps; eStep++) {
    const e = stepCenter(eStep, steps);
    const rowBase = eStep * steps;
    for (let mStep = 0; mStep < steps; mStep++) {
      lut[rowBase + mStep] = packedBiomeColor(classify(e, stepCenter(mStep, steps), biases));
    }
  }
  return lut;
}

/** Moisture ramp length: one entry per byte value of an 8-bit field sample. */
export const MOISTURE_RAMP_STEPS = 256;

/** Committed ramp endpoints (D2/D3 palette family): dry sand → deep teal. */
export const MOISTURE_RAMP_FROM = '#d8c790';
export const MOISTURE_RAMP_TO = '#20658c';

/**
 * 256-entry moisture color ramp: linear interpolation from dry sand #d8c790
 * to deep teal #20658c (the committed ocean hue — the overlay family reads as
 * "water increasing"). Alpha 255 at every step.
 */
export function buildMoistureRamp(): Uint32Array {
  const [r0, g0, b0] = hexToRgb(MOISTURE_RAMP_FROM);
  const [r1, g1, b1] = hexToRgb(MOISTURE_RAMP_TO);
  const ramp = new Uint32Array(MOISTURE_RAMP_STEPS);
  for (let i = 0; i < MOISTURE_RAMP_STEPS; i++) {
    const t = i / (MOISTURE_RAMP_STEPS - 1);
    ramp[i] = packRGBA(
      Math.round(r0 + (r1 - r0) * t),
      Math.round(g0 + (g1 - g0) * t),
      Math.round(b0 + (b1 - b0) * t),
    );
  }
  return ramp;
}

// Module-level memos: the default-LUT / ramp paths of composeChunk reuse one
// instance instead of rebuilding per call (both are immutable by convention).
let defaultBiomeLut: Uint32Array | undefined;
let cachedMoistureRamp: Uint32Array | undefined;

/**
 * Composes the row-chunk `[fromRow, toRow)` of `fields` into `out`
 * (length = resolution², one packed pixel per element):
 *
 * - `'biomes'`: LUT lookup at (quantized e, quantized m); `lut` defaults to
 *   the unbiassed 64×64 table.
 * - `'elevation'`: grayscale, r = g = b = round(e · 255).
 * - `'moisture'`: 256-entry ramp at round(m · 255).
 *
 * Rows are clamped to [0, resolution); returns the number of rows written.
 * Each row is a self-contained span, so chunked and whole-frame composition
 * are element-wise identical.
 */
export function composeChunk(
  mode: RenderMode,
  fields: Fields,
  out: Uint32Array,
  fromRow: number,
  toRow: number,
  lut?: Uint32Array,
): number {
  const { elevation, moisture, resolution } = fields;
  const start = fromRow < 0 ? 0 : fromRow;
  const end = toRow > resolution ? resolution : toRow;
  if (end <= start) return 0;

  switch (mode) {
    case 'elevation': {
      for (let y = start; y < end; y++) {
        const rowBase = y * resolution;
        for (let x = 0; x < resolution; x++) {
          const i = rowBase + x;
          const gray = Math.round(elevation[i] * 255);
          out[i] = packRGBA(gray, gray, gray);
        }
      }
      break;
    }
    case 'moisture': {
      const ramp = cachedMoistureRamp ?? (cachedMoistureRamp = buildMoistureRamp());
      for (let y = start; y < end; y++) {
        const rowBase = y * resolution;
        for (let x = 0; x < resolution; x++) {
          const i = rowBase + x;
          out[i] = ramp[Math.round(moisture[i] * 255)];
        }
      }
      break;
    }
    case 'biomes': {
      const table = lut ?? (defaultBiomeLut ?? (defaultBiomeLut = buildBiomeLut()));
      const steps = Math.round(Math.sqrt(table.length));
      const lastStep = steps - 1;
      for (let y = start; y < end; y++) {
        const rowBase = y * resolution;
        for (let x = 0; x < resolution; x++) {
          const i = rowBase + x;
          const eStep = Math.min(lastStep, Math.floor(elevation[i] * steps));
          const mStep = Math.min(lastStep, Math.floor(moisture[i] * steps));
          out[i] = table[eStep * steps + mStep];
        }
      }
      break;
    }
  }

  return end - start;
}
