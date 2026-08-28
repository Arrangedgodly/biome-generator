/**
 * Fractal Brownian motion (fBm) layered over the hand-ported 2D simplex noise.
 */
import { createSimplex2D } from './simplex.ts';

export interface FbmOptions {
  /** Number of noise layers stacked on top of each other. Default 5. */
  octaves?: number;
  /** Frequency multiplier between successive octaves. Default 2.0. */
  lacunarity?: number;
  /** Amplitude multiplier between successive octaves (persistence). Default 0.5. */
  gain?: number;
  /** Frequency of octave 0 — roughly cycles across the input coordinate span. Default 1. */
  baseFreq?: number;
  /** Seed; each octave is decorrelated with seed + 1013 · octave. Default 0. */
  seed?: number;
}

interface ResolvedFbmOptions {
  octaves: number;
  lacunarity: number;
  gain: number;
  baseFreq: number;
  seed: number;
}

const DEFAULTS: Readonly<ResolvedFbmOptions> = {
  octaves: 5,
  lacunarity: 2.0,
  gain: 0.5,
  baseFreq: 1,
  seed: 0,
};

/** Stride added to the seed per octave so octave fields are decorrelated. */
const OCTAVE_SEED_STRIDE = 1013;

function resolveOptions(opts: FbmOptions): ResolvedFbmOptions {
  // Clamp octaves to at least 1: zero octaves would divide by a zero norm.
  const octaves = Math.max(1, Math.floor(opts.octaves ?? DEFAULTS.octaves));
  return {
    octaves,
    lacunarity: opts.lacunarity ?? DEFAULTS.lacunarity,
    gain: opts.gain ?? DEFAULTS.gain,
    baseFreq: opts.baseFreq ?? DEFAULTS.baseFreq,
    seed: opts.seed ?? DEFAULTS.seed,
  };
}

function cacheKey(o: ResolvedFbmOptions): string {
  // Every seed-relevant option must participate in the key.
  return `${o.seed}|${o.octaves}|${o.lacunarity}|${o.gain}|${o.baseFreq}`;
}

/** Memoized noise samplers, shared between the `fbm2D` convenience wrapper. */
const fbmCache = new Map<string, (x: number, y: number) => number>();

/**
 * Factory that closes over the per-octave simplex instances. Building the
 * permutation tables is ~2 KB and 512 swaps of work per octave, so callers
 * sampling many pixels (T3 field generation) should hold the returned function
 * (or use `fbm2D`, which memoizes internally per options).
 */
export function createFbm2D(opts: FbmOptions = {}): (x: number, y: number) => number {
  const o = resolveOptions(opts);
  const octaves: ((x: number, y: number) => number)[] = [];
  for (let octave = 0; octave < o.octaves; octave++) {
    octaves.push(createSimplex2D(o.seed + OCTAVE_SEED_STRIDE * octave));
  }
  return (x: number, y: number): number => {
    let total = 0;
    let norm = 0;
    let amplitude = 1;
    let freq = o.baseFreq;
    for (let octave = 0; octave < octaves.length; octave++) {
      total += amplitude * octaves[octave](x * freq, y * freq);
      norm += amplitude;
      amplitude *= o.gain;
      freq *= o.lacunarity;
    }
    return total / norm;
  };
}

/**
 * Sample fBm at (x, y), normalized by the summed octave amplitudes so the
 * result stays within roughly [-1, 1] for any option set. The per-octave
 * simplex instances are built once per distinct options combination and
 * memoized, so per-pixel calls never rebuild permutation tables.
 */
export function fbm2D(x: number, y: number, opts: FbmOptions = {}): number {
  const key = cacheKey(resolveOptions(opts));
  let sample = fbmCache.get(key);
  if (sample === undefined) {
    sample = createFbm2D(opts);
    fbmCache.set(key, sample);
  }
  return sample(x, y);
}
