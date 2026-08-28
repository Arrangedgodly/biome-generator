# RQ1 — Noise algorithm, fBm parameters, validation strategy

Affects: T2 (noise module), T3 (field pipeline) · Priority: P0 · Status: ✅ **committed 2026-08-26** (user approved recommended option)

## Question

Simplex or Perlin for stylized RPG continents at ~512², what fBm parameters give organic continents without mush, and how should a hand-written implementation be unit-test validated?

## Constraints / evaluation criteria

Hand-implemented only (no noise libraries — learning + portfolio goal). Runs in a worker at ~512² × 2 fields × ~5 octaves ≈ 2.6M noise calls per generation. Visual target: organic continent shapes, no axis-aligned artifacts, no mush.

## Options considered

1. **2D Simplex noise (Gustavson 2005 reference port)** — simplicial grid, no axis bias in 2D, moderately trickier to port (skewed grid, 3-corner kernel). ✅ recommended
2. **Improved Perlin (2002)** — simplest hand-implementation (perm table + quintic fade + 4-corner lerp), but 2D features align at 45°/90° and this *cannot* be fixed by domain rotation (fix requires 3D sampling) — KdotJPG's "The Perlin Problem" analysis. Clean fallback with identical fBm/test scaffolding if the simplex port stalls.
3. **Value noise** — easiest, worst quality ("blurred pixel grid"). Rejected.
4. **OpenSimplex2** — better-tuned gradients, but reference is Java, more complex to hand-write, marginal gain at 512². Rejected.

Licensing: simplex patent covered 3D+ hardware texture synthesis, expired 2022-01-08; 2D never implicated; classic Perlin never patented. No constraint.

## Recommendation

- `simplex2D(x, y, seed)` ported from Gustavson's public-domain Java reference (fixed 512-entry perm table from a seeded PRNG; F2/G2 skew constants + 70× scale from the paper).
- fBm: **octaves 5, lacunarity 2.0, gain 0.5**, normalize by Σ amplitudes; per-octave seed offset (ideally slight domain rotation) to decorrelate octaves; base frequency ~3–4 relative to map width.
- Elevation post-shaping: `pow(e, ~1.5)` redistribution (flat valleys, sharp peaks) + island falloff blend `1−(1−nx²)(1−ny²)`.
- Moisture: **different seed entirely, 2–3 octaves, base frequency 2–3** (climate is smoother/larger-scale than relief) — prevents visual correlation between fields (explicit Red Blob Games practice).
- Failure-mode vocabulary for tuning: too few octaves / gain <0.4 ⇒ mush (featureless blobs); gain >0.6 or >8 octaves ⇒ spiky static; lacunarity →1 ⇒ banding; >3 ⇒ sub-pixel aliasing.

## Validation strategy for T2 (no published numeric vectors exist for either algorithm)

1. **Golden values:** port reference implementation, snapshot ~16 outputs at arbitrary fractional coords with seed 0, compare at tolerance 1e-10 (JS doubles → deterministic cross-platform).
2. **Statistical invariants:** mean ≈ 0 (±0.02 over a 512² grid); bounded range; continuity `|f(x+1e-4)−f(x)|` small; same seed ⇒ byte-identical Float32Array.
3. **Structural checks:** F2/G2 constants and scale factor match the paper. (Perlin alternative has cleaner invariants: noise = 0 at integer lattice points, fade(0)=fade(1)=0.)

## Evidence

- Red Blob Games, "Making maps with noise functions" — octaves ≤6, persistence halving, Σ-normalization, per-octave offsets, island falloff, pow redistribution; moisture = independently seeded noise + Whittaker table. https://www.redblobgames.com/maps/terrain-from-noise/
- libnoise Perlin module docs + source — defaults 6 octaves / lacunarity 2.0 / persistence 0.5; "best results" lacunarity 1.5–3.5. https://libnoise.sourceforge.net/docs/classnoise_1_1module_1_1Perlin.html
- KdotJPG, "The Perlin Problem" (2022-01-16) — 2D Perlin 45°/90° alignment, unfixable in 2D. https://noiseposti.ng/posts/2022-01-16-The-Perlin-Problem-Moving-Past-Square-Noise.html
- Gustavson, "Simplex noise demystified" (2005-03-22, public-domain Java reference; canonical Linköping URL dead — ResearchGate, corroborated by SRombauts/SimplexNoise and simplex-23d-rs ports).
- Ken Perlin, improved noise reference (2002). https://mrl.cs.nyu.edu/~perlin/noise/
- Digital Freepen, "The range of Perlin noise" (2017) — improved Perlin 2D bound ±0.7071, ≈zero-mean distribution. https://digitalfreepen.com/2017/06/20/range-perlin-noise.html
- US6867776B2 + Wikipedia simplex noise — patent scope/expiry.

## Tradeoffs / risks / confidence

Algorithm + patent: **high**. fBm config: **high** (multiple independent sources agree); exact base frequency at 512²: **medium** — visual tuning in production. Validation: **medium-high** (golden values self-generated from verified port). Risk: simplex port is subtler than Perlin — budget a careful half-day with tests; Perlin is the documented fallback with identical scaffolding.

## Implementation consequences

- T2: `simplex2D` + `fbm2D(x, y, {octaves: 5, lacunarity: 2, gain: 0.5, baseFreq, seedOffset})`; golden + statistical + structural tests.
- T3: elevation = fBm(baseFreq 3–4, 5 oct) → pow(~1.5) → falloff blend → normalize [0,1]; moisture = fBm(different seed, baseFreq 2–3, 2–3 oct) → normalize. All params in one tunable config object.
