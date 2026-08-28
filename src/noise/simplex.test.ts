import { describe, it, expect } from 'vitest';
import { F2, G2, SIMPLEX_SCALE, buildPermutation, createSimplex2D } from './simplex.ts';
import { mulberry32 } from './random.ts';

describe('simplex structural constants', () => {
  it('F2 and G2 match Gustavson (3 − √3)/6 derivation', () => {
    expect(F2).toBeCloseTo(0.3660254037844386, 15);
    expect(G2).toBeCloseTo(0.21132486540518713, 15);
    expect(SIMPLEX_SCALE).toBe(70);
  });
});

describe('permutation table construction', () => {
  it('same seed produces the identical 512-entry table', () => {
    const a = buildPermutation(42);
    const b = buildPermutation(42);
    expect(a.length).toBe(512);
    for (let i = 0; i < 512; i++) {
      expect(a[i]).toBe(b[i]);
    }
  });

  it('is a shuffled permutation of 0..255 duplicated into 512 entries', () => {
    const perm = buildPermutation(7);
    const firstHalf = Array.from(perm.slice(0, 256)).sort((x, y) => x - y);
    expect(firstHalf).toEqual(Array.from({ length: 256 }, (_, i) => i));
    for (let i = 256; i < 512; i++) {
      expect(perm[i]).toBe(perm[i & 255]);
    }
  });

  it('different seeds produce different tables', () => {
    const a = buildPermutation(1);
    const b = buildPermutation(2);
    const differing = Array.from(a).filter((v, i) => v !== b[i]).length;
    // A random shuffle collision would agree on ~1 entry; require real divergence.
    expect(differing).toBeGreaterThan(200);
  });
});

describe('simplex determinism', () => {
  it('two instances with the same seed agree exactly at 100 fixed points', () => {
    const f1 = createSimplex2D(42);
    const f2 = createSimplex2D(42);
    const rand = mulberry32(12345);
    for (let k = 0; k < 100; k++) {
      const x = rand() * 100 - 50;
      const y = rand() * 100 - 50;
      expect(f1(x, y)).toBe(f2(x, y));
    }
  });
});

describe('simplex bounds', () => {
  it('10,000 samples over a [0,100) grid all lie within [-1, 1]', () => {
    const noise = createSimplex2D(7);
    const violations: number[] = [];
    for (let i = 0; i < 100; i++) {
      for (let j = 0; j < 100; j++) {
        // Fractional offsets avoid only ever hitting the integer lattice.
        const x = i + (j % 7) * 0.13;
        const y = j + (i % 5) * 0.17;
        const v = noise(x, y);
        if (v < -1 || v > 1) violations.push(v);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('simplex continuity', () => {
  it('|f(x + 1e-4, y) − f(x, y)| < 0.01 at 200 deterministic points', () => {
    const noise = createSimplex2D(9);
    const rand = mulberry32(987);
    for (let k = 0; k < 200; k++) {
      const x = rand() * 50;
      const y = rand() * 50;
      const delta = Math.abs(noise(x + 1e-4, y) - noise(x, y));
      expect(delta).toBeLessThan(0.01);
    }
  });
});

describe('simplex golden values (createSimplex2D(0))', () => {
  // Regression reference: generated once from this verified port (Gustavson
  // 2005). The structural + statistical tests above are the correctness guard.
  const golden: [number, number, number][] = [
    [0.1, 0.2, -0.8593460940089056],
    [0.7, 0.3, -0.7933468101611673],
    [1.25, 0.5, -0.06142379697275745],
    [0.5, 1.25, -0.3913217811312666],
    [2.3, 3.7, 0.3023582712597883],
    [10.1, 5.9, 0.6039548755274462],
    [0.01, 0.02, -0.13072578697513126],
    [0.98, 0.99, -0.4408868161377878],
    [-0.5, -0.5, 0],
    [-1.7, 2.3, 0.2787419443663876],
    [3.3, 3.3, -0.4550935563683866],
    [7.7, 0.1, 0.7443856348335108],
    [0.4, 9.6, 0.6442941276137039],
    [12.34, 56.78, -0.24746487969049893],
    [-9.1, 4.2, 0.5596165735301214],
    [0.55, -0.55, -0.6612715610835757],
  ];

  it('matches the recorded values at all 16 coordinate pairs', () => {
    const noise = createSimplex2D(0);
    for (const [x, y, expected] of golden) {
      expect(noise(x, y)).toBeCloseTo(expected, 10);
    }
  });
});
