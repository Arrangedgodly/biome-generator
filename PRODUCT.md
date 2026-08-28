# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, equally weighted (confirmed):

- **Employers and recruiters skimming a portfolio.** They land cold, spend ~30 seconds, and must be won over without reading code or docs.
- **Technical peers who enjoy procedural generation.** They poke the sliders and seed, read the README, and may open the source.

The builder is a third, secondary user: this is also a personal learning artifact (the noise is implemented by hand for that reason).

## Product Purpose

An interactive canvas that generates 2D RPG-style biome maps — oceans, beaches, forests, mountains — from user-controlled elevation, moisture, and a randomness seed. It exists as a portfolio piece, a learning artifact, and a toy. Success for a first-time visitor is three things at once (confirmed "all three equally"):

1. **Understanding** — "oh, *that's* how noise becomes a map";
2. **Respect for the craft** — worker architecture, tests, perf budgets, determinism;
3. **Play** — generating maps, tweaking presets, sharing a seeded link.

## Positioning

Neighboring generators show a finished map. This one **teaches while it runs**: generation is animated in stages — grayscale elevation → moisture overlay → biome colorization — so the visitor watches the algorithm think. Backed by a hand-ported Simplex/fBm implementation (no noise libraries, by design) with all math off the main thread. That combination — staged pedagogy plus verifiable engineering discipline — is the claim a neighbor could not truthfully copy.

## Operating Context

- Deployed at **https://biome.arrangedgodly.com/** (GitHub Pages via Actions, custom domain; repo `Arrangedgodly/biome-generator`).
- All shareable state lives in the URL hash (`#v=1&seed=…&el=…&mo=…&preset=…`); opening a link reproduces the exact map.
- Local development: `npm run dev`; the full gate is `npm test` (213 tests), `npm run typecheck`, `npm run build`.

## Capabilities and Constraints

Confirmed functionality: 12-biome elevation-first classifier (sea level 0.40); deterministic seeded generation — same seed + params → byte-identical map (hash-pinned in tests); three calibrated presets (Archipelago, Continent, Highlands); hybrid slider semantics (moisture reclassifies instantly via LUT; elevation recomputes in the worker, debounced, with a 256² preview during drags); staged animation with Skip, input-cancel, and reduced-motion bypass; PNG export; shareable URL state; retry-with-recovery on worker failure.

Binding technical constraints (product decisions, not implementation details):

- Noise is **hand-implemented** — no noise libraries, ever (learning/portfolio goal).
- All noise math stays in the **Web Worker**; the main thread must never block on generation.
- Fixed 512² internal resolution with nearest-neighbor upscale (pixel-art crispness).
- Biome table, palette, and fBm defaults are calibrated, committed decisions backed by measurement (docs/ultron/research + production-log); recalibration must re-measure, not guess.

## Brand Commitments

The name **"Procedural Biome Generator"** is fixed. No logo or other brand assets exist.

## Evidence on Hand

- The deployed app itself (primary demo).
- `README.md` — verified factual architecture/perf summary.
- `docs/ultron/evidence/t16/` — perf traces, engine measurements, exported PNGs.
- Test suite: 213 tests / 16 suites, including hash-pinned determinism and calibration regressions.

Absences future work must not fabricate: no user testimonials, no usage analytics, no external press or third-party benchmarks.

## Product Principles

1. **Reveal, don't just render.** The staged algorithm *is* the product; features should deepen understanding of how noise becomes a map.
2. **Craft is the message.** The engineering discipline (worker isolation, determinism, tested calibration, perf budgets) is itself the portfolio argument — never trade it for surface polish.
3. **Instant for skimmers, deep for diggers.** The first 30 seconds must land unattended; README, evidence, and source reward those who go further.
4. **Determinism is a promise.** Same seed/params/URL → the same world, everywhere; sharing a link shares the exact map.
5. **Accessibility is a commitment, not garnish.** WCAG 2.2 AA is a stated bar the product maintains (confirmed).

## Accessibility & Inclusion

WCAG 2.2 AA, formally committed (user-confirmed 2026-08-27). Already shipped: reduced-motion animation bypass, aria-live stage announcements, contrast-verified palette (ΔL ≥ 0.08 adjacency incl. deuteranopia simulation), non-text contrast ≥ 3:1 on focus states (test-verified).
