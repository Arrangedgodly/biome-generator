import { describe, expect, it } from 'vitest';
import {
  buildBiomeLut,
  buildMoistureRamp,
  composeChunk,
  LUT_STEPS,
  MOISTURE_RAMP_FROM,
  MOISTURE_RAMP_TO,
  packRGBA,
  quantizeToStep,
  stepCenter,
} from './compose.ts';
import { BIOMES, classify, ELEVATION_BANDS, MOISTURE_BANDS, NO_BIASES } from '../generation/biomes.ts';
import type { ClassifyBiases } from '../generation/biomes.ts';
import { DEFAULT_FIELD_PARAMS, generateFields } from '../generation/fields.ts';
import type { Fields } from '../generation/fields.ts';
import { mulberry32 } from '../noise/random.ts';

/**
 * Expected-color helpers derive packed pixels through byte views — [r, g, b,
 * 255] written into memory then read as a Uint32 — so assertions never assume
 * platform endianness and never reuse the implementation's packing code.
 */
function packHex(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  const bytes = new Uint8Array(4);
  bytes[0] = (v >> 16) & 0xff;
  bytes[1] = (v >> 8) & 0xff;
  bytes[2] = v & 0xff;
  bytes[3] = 255;
  return new Uint32Array(bytes.buffer)[0];
}

function channelsOf(packed: number): [number, number, number] {
  const bytes = new Uint8Array(new Uint32Array([packed]).buffer);
  return [bytes[0], bytes[1], bytes[2]];
}

/** In-test endianness probe (same trick as the implementation, kept independent). */
const ENDIAN_PROBE = new Uint32Array(1);
ENDIAN_PROBE[0] = 1;
const IS_LITTLE_ENDIAN = new Uint8Array(ENDIAN_PROBE.buffer)[0] === 1;

describe('packRGBA', () => {
  it('stores r, g, b, a=255 in ImageData byte order (verified through a byte view)', () => {
    const pixels = new Uint32Array(1);
    pixels[0] = packRGBA(1, 2, 3);
    expect([...new Uint8Array(pixels.buffer)]).toEqual([1, 2, 3, 255]);
  });

  it('matches the platform word formula (little-endian: 0x030201 | 255<<24)', () => {
    if (IS_LITTLE_ENDIAN) {
      expect(packRGBA(0x30, 0x20, 0x10)).toBe((0x102030 | (255 << 24)) >>> 0);
    } else {
      expect(packRGBA(0x30, 0x20, 0x10)).toBe(((0x30 << 24) | (0x20 << 16) | (0x10 << 8) | 255) >>> 0);
    }
  });
});

describe('buildBiomeLut', () => {
  it('classifies the (e≈0.5, m≈0.6) cell exactly as classify does (lowland → grassland)', () => {
    const lut = buildBiomeLut();
    const eStep = quantizeToStep(0.5); // 32
    const mStep = quantizeToStep(0.6); // 38
    expect(lut.length).toBe(LUT_STEPS * LUT_STEPS);
    expect(classify(0.5, 0.6)).toBe('grassland'); // anchor against the committed table
    expect(lut[eStep * LUT_STEPS + mStep]).toBe(
      packHex(BIOMES[classify(stepCenter(eStep), stepCenter(mStep), NO_BIASES)].hex),
    );
  });

  it('equals classify(quantized e, quantized m) at every cell (exhaustive 64×64, NO_BIASES)', () => {
    const lut = buildBiomeLut(NO_BIASES);
    let mismatches = 0;
    for (let eStep = 0; eStep < LUT_STEPS; eStep++) {
      for (let mStep = 0; mStep < LUT_STEPS; mStep++) {
        const expected = packHex(
          BIOMES[classify(stepCenter(eStep), stepCenter(mStep), NO_BIASES)].hex,
        );
        if (lut[eStep * LUT_STEPS + mStep] !== expected) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('with moistureBias +0.3 shifts cells exactly as classify does (200-cell sample)', () => {
    const biases: ClassifyBiases = { seaLevelBias: 0, moistureBias: 0.3 };
    const biased = buildBiomeLut(biases);
    const unbiased = buildBiomeLut();
    const rng = mulberry32(20260827);
    let classifyMismatches = 0;
    let shiftedCells = 0;
    for (let k = 0; k < 200; k++) {
      const eStep = Math.floor(rng() * LUT_STEPS);
      const mStep = Math.floor(rng() * LUT_STEPS);
      const cell = eStep * LUT_STEPS + mStep;
      const expected = packHex(BIOMES[classify(stepCenter(eStep), stepCenter(mStep), biases)].hex);
      if (biased[cell] !== expected) classifyMismatches++;
      if (biased[cell] !== unbiased[cell]) shiftedCells++;
    }
    expect(classifyMismatches).toBe(0);
    expect(shiftedCells).toBeGreaterThan(0); // the bias demonstrably moves cells
  });
});

describe('buildMoistureRamp', () => {
  it('runs #d8c790 → #20658c with a near-exact linear midpoint (alpha 255)', () => {
    const ramp = buildMoistureRamp();
    expect(ramp.length).toBe(256);
    expect(ramp[0]).toBe(packHex(MOISTURE_RAMP_FROM));
    expect(ramp[255]).toBe(packHex(MOISTURE_RAMP_TO));
    const [r0, g0, b0] = channelsOf(ramp[0]);
    const [r1, g1, b1] = channelsOf(ramp[255]);
    const [rm, gm, bm] = channelsOf(ramp[128]);
    expect(Math.abs(rm - (r0 + r1) / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(gm - (g0 + g1) / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(bm - (b0 + b1) / 2)).toBeLessThanOrEqual(2);
    expect(new Uint8Array(new Uint32Array([ramp[128]]).buffer)[3]).toBe(255);
  });
});

describe('composeChunk pixel correctness (fields @64², seed 7)', () => {
  const RES = 64;
  const N = RES * RES;
  const fields: Fields = generateFields(7, DEFAULT_FIELD_PARAMS, RES);
  const lut = buildBiomeLut();
  const ramp = buildMoistureRamp();

  it("elevation mode: r = g = b = round(e·255), alpha 255 (exhaustive)", () => {
    const out = new Uint32Array(N);
    expect(composeChunk('elevation', fields, out, 0, RES)).toBe(RES);
    const bytes = new Uint8Array(out.buffer);
    let mismatches = 0;
    for (let i = 0; i < N; i++) {
      const gray = Math.round(fields.elevation[i] * 255);
      if (bytes[i * 4] !== gray || bytes[i * 4 + 1] !== gray || bytes[i * 4 + 2] !== gray || bytes[i * 4 + 3] !== 255) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('moisture mode: ramp[round(m·255)] (exhaustive)', () => {
    const out = new Uint32Array(N);
    composeChunk('moisture', fields, out, 0, RES);
    let mismatches = 0;
    for (let i = 0; i < N; i++) {
      if (out[i] !== ramp[Math.round(fields.moisture[i] * 255)]) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('biomes mode: LUT[quantize(e), quantize(m)] per pixel; classify disagreements only at quantization edges', () => {
    const out = new Uint32Array(N);
    composeChunk('biomes', fields, out, 0, RES, lut);
    // Band boundaries, derived from the committed constants (not duplicated).
    const elevationBoundaries = Object.values(ELEVATION_BANDS);
    const moistureBoundaries = Object.values(MOISTURE_BANDS);
    const bin = 1 / LUT_STEPS; // one quantization bin = 1/64 on each axis
    let lutMismatches = 0;
    let classifyAgreements = 0;
    let unexplainedDisagreements = 0;
    for (let i = 0; i < N; i++) {
      const e = fields.elevation[i];
      const m = fields.moisture[i];
      const eStep = quantizeToStep(e);
      const mStep = quantizeToStep(m);
      if (out[i] !== lut[eStep * LUT_STEPS + mStep]) lutMismatches++;
      if (out[i] === packHex(BIOMES[classify(e, m)].hex)) {
        classifyAgreements++;
      } else {
        // A pixel may only disagree with full-precision classify when the
        // pixel and its bin center fall on opposite sides of a band boundary —
        // which requires the pixel to sit within one bin width of a boundary.
        const nearElevationEdge = elevationBoundaries.some((b) => Math.abs(e - b) <= bin + 1e-9);
        const nearMoistureEdge = moistureBoundaries.some((b) => Math.abs(m - b) <= bin + 1e-9);
        if (!nearElevationEdge && !nearMoistureEdge) unexplainedDisagreements++;
      }
    }
    // eslint-disable-next-line no-console -- measured agreement recorded for the production log.
    console.log(
      `[lut] 64² biomes vs full-precision classify: agreement ${(classifyAgreements / N).toFixed(4)} (seed 7); all disagreements within one 1/64 quantization bin of a band boundary`,
    );
    expect(lutMismatches).toBe(0);
    expect(unexplainedDisagreements).toBe(0);
    // 64×64 quantization puts a ~1.6%-wide fringe around every band boundary
    // where the LUT picks a bin-center biome. Empirically ~97% of pixels agree
    // exactly (the planning estimate assumed ≥99.5%); the boundary-proximity
    // assertion above is the exact-correctness guarantee, this is the floor.
    expect(classifyAgreements / N).toBeGreaterThanOrEqual(0.95);
  });

  it("biomes mode without an explicit lut uses the NO_BIASES default", () => {
    const withDefault = new Uint32Array(N);
    const withExplicit = new Uint32Array(N);
    composeChunk('biomes', fields, withDefault, 0, RES);
    composeChunk('biomes', fields, withExplicit, 0, RES, buildBiomeLut());
    let mismatches = 0;
    for (let i = 0; i < N; i++) {
      if (withDefault[i] !== withExplicit[i]) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('composeChunk chunking', () => {
  const RES = 64;
  const N = RES * RES;
  const fields: Fields = generateFields(7, DEFAULT_FIELD_PARAMS, RES);
  const lut = buildBiomeLut();
  const modes = ['elevation', 'moisture', 'biomes'] as const;

  it('two 32-row chunks equal one 64-row compose (element-wise, all modes)', () => {
    for (const mode of modes) {
      const chunked = new Uint32Array(N);
      const whole = new Uint32Array(N);
      const first = composeChunk(mode, fields, chunked, 0, 32, lut);
      const second = composeChunk(mode, fields, chunked, 32, 64, lut);
      composeChunk(mode, fields, whole, 0, RES, lut);
      let mismatches = 0;
      for (let i = 0; i < N; i++) {
        if (chunked[i] !== whole[i]) mismatches++;
      }
      expect(first).toBe(32);
      expect(second).toBe(32);
      expect(mismatches).toBe(0);
    }
  });

  it('clamps row ranges and reports rows written', () => {
    const out = new Uint32Array(N);
    expect(composeChunk('elevation', fields, out, 16, 999)).toBe(RES - 16);
    expect(composeChunk('elevation', fields, out, -5, 8)).toBe(8);
    expect(composeChunk('elevation', fields, out, 40, 40)).toBe(0);
    expect(composeChunk('elevation', fields, out, 50, 10)).toBe(0);
  });
});

describe('composeChunk performance (D2 budget: <8ms per 64-row chunk @512²)', () => {
  it('full 512² biomes compose: average chunk < 8ms, full frame < 40ms', () => {
    const res = 512;
    const big = generateFields(7, DEFAULT_FIELD_PARAMS, res);
    const out = new Uint32Array(res * res);
    const lut = buildBiomeLut();

    // JIT warm-up pass — not measured.
    for (let from = 0; from < res; from += 64) {
      composeChunk('biomes', big, out, from, from + 64, lut);
    }

    const chunkTimes: number[] = [];
    const totalStart = performance.now();
    for (let from = 0; from < res; from += 64) {
      const start = performance.now();
      composeChunk('biomes', big, out, from, from + 64, lut);
      chunkTimes.push(performance.now() - start);
    }
    const total = performance.now() - totalStart;
    const avg = chunkTimes.reduce((sum, t) => sum + t, 0) / chunkTimes.length;
    const max = Math.max(...chunkTimes);
    // eslint-disable-next-line no-console -- D2 requires measured evidence, logged for the production record.
    console.log(
      `[perf] 512² biomes compose: ${chunkTimes.length} chunks of 64 rows — avg ${avg.toFixed(3)}ms, max ${max.toFixed(3)}ms, total ${total.toFixed(3)}ms (budgets: <8ms avg/chunk, <40ms frame)`,
    );

    expect(chunkTimes).toHaveLength(8);
    expect(avg).toBeLessThan(8);
    expect(total).toBeLessThan(40);
  });
});
