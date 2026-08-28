# Research Summary — Procedural Biome Generator

Date: 2026-08-26 · Phase: Deep Research · Source: `plan.md` research queue RQ1–RQ5 (approved unchanged at plan gate).

## Delegation record

All five tracks were delegated to focused general-purpose subagents running web research against primary sources (official docs, papers, caniuse/MDN compat data, WebKit release notes, Red Blob Games). No track required a direct fallback; no spikes were needed — documentation + benchmarks sufficed. Tracks ran in parallel; conflicts synthesized by parent (none material).

## Decision matrix

| ID | Question | Tasks | Priority | Recommendation | Status |
|---|---|---|---|---|---|
| D1 | Simplex vs Perlin + fBm params + validation strategy | T2, T3 | P0 | 2D Simplex (Gustavson 2005 port); fBm 5 octaves / lacunarity 2.0 / gain 0.5; golden-value + statistical tests | ✅ committed 2026-08-26 |
| D2 | Resolution, fixed/responsive, frame strategy, compute budget | T3, T7, T8, T16 | P0 | Fixed 512² internal, CSS-scaled `pixelated`; 256² interactive preview on drag + 512² regen on release; pre-composed stage frames + `globalAlpha` crossfade; palette LUT | ✅ committed 2026-08-26 |
| D3 | Biome crosswalk + luminance-separated palette | T4, T9 | P0 | Elevation-first 12-biome table (sea level 0.40); 4 moisture bands; ΔL ≥ 0.08 rule; specific hex palette | ✅ committed 2026-08-26 |
| D4 | Stack verification + hosting | T1, T18 | P0 | CONFIRM TypeScript + Vite 8 (vanilla-ts); GitHub Pages via Actions; `base: '/<repo>/'` | ✅ committed 2026-08-26 |
| D5 | Safari worker pitfalls → fallback needed? | T5, T10 | P1 | NO main-thread fallback (support universal Safari 15+); pin `worker.format: 'iife'`; buffer-detach invariants | ✅ committed 2026-08-26 |

Approval provenance: decision matrix presented with per-decision recommended options; user responded "approved" (2026-08-26), approving the recommended option for each. No revisions, deferrals, or rejections.

## Cross-track synthesis

- D2's dual-resolution preview is the only recommendation that **adds task content** beyond what plan.md sketched (T3 gains a resolution parameter + preview regen on pointer-up; T6 gains a preview path). Outcome and acceptance criteria unchanged (instant feel, determinism). Folded into plan on approval; whole-plan re-approval required per gate.
- D1 + D3 compose cleanly: elevation field (5 octaves) → pow redistribution + island falloff → elevation-first biome bands; moisture field (independent seed, 2–3 octaves, smoother) feeds the moisture bands. Exactly the Red Blob Games structure both tracks independently converged on.
- D4 + D5 compose: Vite default `worker.format: 'iife'` already covers the Safari concern; pinning it is zero-cost insurance.
- Determinism guarantee (success measure #2) is protected by D2's fixed internal resolution — same seed+params → identical fields regardless of screen size.

## Records

- `rq1-noise.md` — algorithm, fBm, validation (D1) ✅
- `rq2-resolution-performance.md` — resolution, budgets, frame strategy (D2) ✅
- `rq3-biome-palette.md` — crosswalk, biome set, palette (D3) ✅
- `rq4-stack-hosting.md` — Vite verification, host choice, setup outline (D4) ✅
- `rq5-safari-workers.md` — compat matrix, fallback verdict, invariants (D5) ✅
