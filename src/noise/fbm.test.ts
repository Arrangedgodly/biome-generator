import { describe, it, expect } from 'vitest';
import { createFbm2D, fbm2D } from './fbm.ts';
import { mulberry32 } from './random.ts';

describe('fbm memoization and defaults', () => {
  it('repeated calls (cache-hit path) return identical values', () => {
    expect(fbm2D(0.3, 0.7)).toBe(fbm2D(0.3, 0.7));
    expect(fbm2D(1.9, -2.4)).toBe(fbm2D(1.9, -2.4));
  });

  it('explicit defaults resolve to the same cached sampler as no options', () => {
    const a = fbm2D(0.4, 0.6);
    const b = fbm2D(0.4, 0.6, { octaves: 5, lacunarity: 2.0, gain: 0.5, baseFreq: 1, seed: 0 });
    expect(a).toBe(b);
  });

  it('createFbm2D factory agrees with the fbm2D wrapper', () => {
    const sample = createFbm2D({ seed: 3, baseFreq: 2.5 });
    expect(sample(0.25, 0.75)).toBe(fbm2D(0.25, 0.75, { seed: 3, baseFreq: 2.5 }));
  });
});

describe('fbm determinism', () => {
  it('same seed and coords produce identical output', () => {
    const rand = mulberry32(777);
    for (let k = 0; k < 50; k++) {
      const x = rand();
      const y = rand();
      expect(fbm2D(x, y, { seed: 99 })).toBe(fbm2D(x, y, { seed: 99 }));
    }
  });

  it('different seeds decorrelate the field', () => {
    const rand = mulberry32(778);
    let differing = 0;
    for (let k = 0; k < 50; k++) {
      const x = rand();
      const y = rand();
      if (fbm2D(x, y, { seed: 100 }) !== fbm2D(x, y, { seed: 101 })) differing++;
    }
    // Overwhelming probability: essentially every sample should differ.
    expect(differing).toBeGreaterThanOrEqual(49);
  });
});

describe('fbm bounds', () => {
  it('5,000 samples all lie within [-1, 1]', () => {
    const violations: number[] = [];
    for (let i = 0; i < 50; i++) {
      for (let j = 0; j < 100; j++) {
        const v = fbm2D(i * 0.0197 + 0.05, j * 0.0099 + 0.03, { seed: 11 });
        if (v < -1 || v > 1) violations.push(v);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('fbm statistics', () => {
  it('512×512 grid, baseFreq 3.5, seed 1 has mean within ±0.02 of 0', () => {
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      for (let j = 0; j < 512; j++) {
        sum += fbm2D(i / 512, j / 512, { baseFreq: 3.5, seed: 1 });
      }
    }
    const mean = sum / (512 * 512);
    expect(Math.abs(mean)).toBeLessThan(0.02);
  });
});

describe('fbm octave composition', () => {
  it('octaves=1 differs from octaves=5 at the same seed', () => {
    const rand = mulberry32(779);
    let differing = 0;
    for (let k = 0; k < 50; k++) {
      const x = rand();
      const y = rand();
      if (fbm2D(x, y, { seed: 5, octaves: 1 }) !== fbm2D(x, y, { seed: 5, octaves: 5 })) differing++;
    }
    expect(differing).toBeGreaterThan(0);
  });
});

describe('fbm continuity', () => {
  it('|fbm(x + 1e-4, y) − fbm(x, y)| < 0.01 at 200 deterministic points', () => {
    const rand = mulberry32(988);
    for (let k = 0; k < 200; k++) {
      const x = rand();
      const y = rand();
      const delta = Math.abs(fbm2D(x + 1e-4, y) - fbm2D(x, y));
      expect(delta).toBeLessThan(0.01);
    }
  });
});
