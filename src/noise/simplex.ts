/**
 * 2D simplex noise, ported from Stefan Gustavson's public-domain reference
 * implementation in "Simplex noise demystified" (2005). No noise libraries —
 * the algorithm is implemented by hand for learning/portfolio purposes.
 */
import { mulberry32 } from './random.ts';

/** Skew factor: how much to stretch (x, y) space to reach simplex-cell space. */
export const F2 = 0.5 * (Math.sqrt(3) - 1); // ≈ 0.3660254037844386

/** Unskew factor: G2 = (3 − √3) / 6, brings simplex cells back to (x, y) space. */
export const G2 = (3 - Math.sqrt(3)) / 6; // ≈ 0.21132486540518713

/** Gustavson's scale factor that maps the raw corner sum into roughly [-1, 1]. */
export const SIMPLEX_SCALE = 70;

/**
 * The 12 gradients of Gustavson's grad3 table (x, y components only — the z
 * component is irrelevant in 2D and therefore omitted).
 */
const GRAD3: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0, 1],
  [0, -1],
];

/**
 * Builds the 512-entry permutation table for a seed: 0..255 shuffled with a
 * Fisher–Yates pass driven by mulberry32(seed), then duplicated so that
 * `perm[i] = p[i & 255]` for the wrapped lookups the algorithm performs.
 *
 * Exported so tests can verify that permutation construction is deterministic.
 */
export function buildPermutation(seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // Fisher–Yates: swap each slot with a uniformly chosen earlier-or-same slot.
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

/**
 * Creates a seeded 2D simplex noise function. Returns a closure over the
 * permutation table; output range is roughly [-1, 1].
 */
export function createSimplex2D(seed: number): (x: number, y: number) => number {
  const perm = buildPermutation(seed);

  // Contribution of one simplex corner: 0 outside its radius, else t⁴ · dot(g, d).
  const corner = (x: number, y: number, gi: number): number => {
    let t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    t *= t;
    const g = GRAD3[gi];
    return t * t * (g[0] * x + g[1] * y);
  };

  return (xin: number, yin: number): number => {
    // Skew the input space to determine which simplex cell we are in.
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    // Unskew the cell origin back to (x, y) space and measure the offset.
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    // Decide which triangle of the skewed square we are in.
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    // Offsets for the middle and last corners in unskewed (x, y) coords.
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1.0 + 2.0 * G2;
    const y2 = y0 - 1.0 + 2.0 * G2;
    // Hashed gradient indices of the three corners.
    const ii = i & 255;
    const jj = j & 255;
    const gi0 = perm[ii + perm[jj]] % 12;
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;
    // Sum the three corner contributions and rescale to roughly [-1, 1].
    const n0 = corner(x0, y0, gi0);
    const n1 = corner(x1, y1, gi1);
    const n2 = corner(x2, y2, gi2);
    return SIMPLEX_SCALE * (n0 + n1 + n2);
  };
}
