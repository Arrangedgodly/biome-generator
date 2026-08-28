# Ultron State — Biome Generator

## Product
Procedural Biome Generator — interactive web app generating 2D RPG-style maps with a staged, animated reveal (elevation → moisture → biomes), hybrid slider semantics, Web Worker noise math, presets, URL-shared state, PNG export, public static deploy.

## Repository
`/Users/arrangedgodly/Documents/Projects/biome-generator` (not a git repo yet)

## Phase Cursor

| Phase | Artifact | Status |
|---|---|---|
| Town Hall | `docs/ultron/town-hall.md` | ✅ **approved 2026-08-26** |
| Plan It Out | `docs/ultron/plan.md` | ✅ approved 2026-08-26 → revised after research → ✅ **whole-plan re-approved 2026-08-27** |
| Deep Research | `docs/ultron/research/` | ✅ **complete — D1–D5 committed 2026-08-26** |
| Production | `docs/ultron/production-log.md` | **in progress** ← current (T1 first) |

## Approvals
- **Town Hall (2026-08-26):** `town-hall.md` approved. Every cluster signed off individually in grilling Rounds 1–2 (user answered "all as recommended" both rounds): problem & users; MVP boundary & non-goals (Challenger/Advocate); journeys/states/success measures & acceptance criteria (Challenger/Advocate on measures); constraints/assumptions/risks; open-question disposition (Challenger/Advocate on worker failure mode). Final record presented; user confirmed nothing missed ("proceed") same day. Conditions: none.
- **Plan It Out (2026-08-26):** `plan.md` approved as presented ("approved lets research") — task breakdown (18 tasks / 6 lanes), critical path T1→T2→T3→T5→T6→T8→T11, milestones M1–M5, research queue RQ1–RQ5, sizing. Conditions: none.
- **Deep Research (2026-08-26):** Five tracks delegated to parallel research subagents (primary sources: Vite/MDN/WebKit/caniuse docs, Gustavson 2005, Red Blob Games, WCAG 2.2). Records in `docs/ultron/research/` (summary + rq1–rq5). Decision matrix presented with per-decision recommendations; user approved ("approved") — **D1–D5 all committed** as recommended, no revisions/deferrals/rejections. D2 added preview-path content to T3/T6 → plan revised.
- **Plan re-approval (2026-08-27):** Revised `plan.md` (D1–D5 folded in; sole delta = D2 preview path in T3/T6; scope/acceptance/milestones unchanged) approved as a whole ("approved"). Production gate open.

## Key Approved Decisions
- Hybrid slider semantics: elevation = debounced worker recompute (terrain character); moisture = instant reclassification; seed/Generate/preset = full animated regen.
- Seed is input + 🎲 button, not a slider.
- Animation 2.5–4s, skippable, mid-animation input cancels; first load auto-animates; prefers-reduced-motion skips.
- All three extras in v1 (3 fixed presets, URL-hash state, PNG export), contained. Descope path if production runs long: defer share/export only.
- Worker failure = friendly error + retry; no main-thread fallback without Safari evidence.
- Stack/deploy preferences (not commitments): TS + Vite, no framework, GitHub Pages.

## Open Decisions (all owned by research unless noted)
- Tech stack verification (preference: TS + Vite, no framework) — blocks production.
- Simplex vs Perlin + octave/fBm parameters — blocks production.
- Canvas resolution (fixed vs responsive, size) — blocks production.
- Deploy target (preference: GitHub Pages) — mildly blocks production.
- Biome table + luminance-separated palette — blocks production.
- Animation timings/easings/skip mechanics — planning (informs production).

## Change Control Notes
- Descope path (defer share/export) requires returning through Ultron change control if invoked.

## Next Action
**DOUBLE HALT (2026-08-27, run 2, ~18/20 dispatches used): T17 human procedure + T18 external publishing — both mandated user stops.** All machine-verifiable work is complete and auto-approved: T1–T16 (+T3b/T3c/T3c-fix/T15/T16-fix insertions) — 213/213 tests, typecheck 0, build 0. T17 protocol at `docs/ultron/t17-human-test-protocol.md` (evidence template at `docs/ultron/evidence/t17/t17-results.md`); T18 runbook at `docs/ultron/t18-deploy-runbook.md` (workflow `.github/workflows/deploy.yml` verified; README verified). On T17 pass evidence from the user → T18 wizard-lane execution (repo creation, Pages enable, push = user-only external publishing). On any T17 fail → fix cycle first (2 dispatches in reserve).

### Coordinator Browser Check (2026-08-27, dispatch cap reached)
Ran the app headlessly at 512² (`npm run dev`, Vite), exercised boot → dice → skip → presets → slider nudge → 375px viewport, and analyzed screenshots via vision model. **Passed:** 3-stage animation (grayscale elevation @~700ms → moisture crossfade @~1.25s → biomes), stage labels + aria-live sequencing, Skip enabling mid-animation, seed readout updating (186872 after dice), instant slider path (stage stays "Biomes", no animation replay, readout 0.96), preset active-state + slider jump + animated regen, 375px layout (no horizontal overflow, square canvas, usable controls).
**Finding (outcome-affecting, fixed by T3b in run 2):** mountain/snow bands were dead (max elevation 0.859 < 0.88 snow threshold; 0.00% mountain+snow across all presets × 8 seeds). T3b added percentile range-normalization + preset recalibration; verified independently.

### Coordinator Visual Sign-off (2026-08-27, run 2)
IAB browser backend broken in this resumed session (broker id mismatch, guest never attaches) — fell back to rendering the REAL pipeline output (generateFields + classify + committed palette hexes) to PNGs in Node and vision-analyzing those. **Verdict: T3b goal confirmed visually** — mountains + snow present on every preset, correctly placed in landmass interiors, thin beach rings, no banding/artifacts, highlands dry-character seed-stable. **Remaining taste critiques (consistent across analyses):** (1) fragmentation — "Continent" reads archipelago-ish (no dominant coherent landmass), "Highlands" reads "mountainous archipelago"; root = elevation slider frequency mapping (2.5+2v); (2) snow/mountain ratio inverted at highlands seed 0 (snow 12–15% vs mountain 5–8%; correct at seed 42). Routed to T3c (parameter tuning only — palette/algorithm untouched). Logged follow-ups, not acting: mountain-gray contrast vs dry yellows (would touch D3-committed palette), single-pixel ocean stragglers / coastline dithering (needs post-processing pass = v2 scope), real-browser share/export round-trip (T14 deferral — IAB unavailable; fold into T16's browser validation or the T17 human test).

---

## Coordinator Lineage

**converted: ultron → ultron-supreme at phase=production, next task = T4 verification (2026-08-27).**

Prior coordinator left T4 (biome classifier) in `awaiting-approval`. Per supreme protocol, the pending user gate is superseded: a verifier subagent validates and auto-approves T4, then production runs continuously (worker → verifier → auto-approve → next) with no further gates except the halt list: destructive/irreversible ops; external publishing (git push, T18 deployment); human-only procedures (T17 two-human comprehension check); scope changes; a task failing twice consecutively; the 20-dispatch task cap.

Auto-approvals are recorded in `plan.md` and `production-log.md` as `auto-approved (ultron-supreme)` with evidence paths. This Next Action section supersedes any earlier one.
