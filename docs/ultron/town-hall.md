# Town Hall — Procedural Biome Generator (Scoping Brief)

Status: **APPROVED** (2026-08-26) — every cluster signed off individually during grilling Rounds 1–2 ("all as recommended").

## Problem Statement

Every procedural map generator toy flashes a finished map on screen. The algorithm stays a black box, and the result feels like a slot machine rather than a system you steer. This app makes the pipeline visible: it generates a 2D RPG-style map (oceans, beaches, forests, mountains) from user-controlled elevation, moisture, and seed controls, and it *shows its work* — grayscale height map first, moisture overlay second, biome colorization last.

## Target Users

- **Primary: the builder** (you) — building it to learn noise math and Web Workers, and to enjoy steering terrain in real time.
- **Secondary: portfolio visitors / strangers** — frontend devs and hiring reviewers who judge polish, responsiveness, and code quality within ~60 seconds.
- Implication: satisfying to poke (instant slider feedback), impressive at first glance (deployed, polished), readable as code (clean structure). It teaches by revealing stages, not by narrating theory.

## Approved MVP

1. **Noise:** hand-implemented Perlin or Simplex (exact choice → research); **all noise math runs in a Web Worker**; main thread only composites/animates. No noise-generation dependency.
2. **Controls:**
   - **Elevation slider** — terrain character (amplitude/roughness). Debounced worker recompute, no animation replay. Feels live, not same-frame.
   - **Moisture slider** — classification bias over cached noise fields. Truly instant, zero recompute.
   - **Seed** — readable text/number input + prominent 🎲 randomize button (not a slider; seed space is huge and unordered).
3. **Staged animation** on Generate / new seed / preset click: `Elevation` → `Moisture` → `Biomes`, ~2.5–4s total, one-word stage labels, smooth transitions, skip affordance. Slider input mid-animation cancels it and jumps to instant mode — never queue, never block.
4. **First load:** default preset auto-generates with the full staged animation (no empty canvas + Generate button). `prefers-reduced-motion` → final map immediately, no animation.
5. **Presets:** exactly 3 fixed snapshots — Archipelago, Continent, Highlands. No preset editor, no thumbnails.
6. **Shareable state:** full control state in the URL hash; opening the link reproduces the map. No backend.
7. **Export PNG** of the current map via canvas.
8. **Public deployment** as a static site.

## Explicit Non-Goals (v1)

- 3D maps, hex grids, tile-based game export formats.
- Rivers, erosion, climate simulation beyond elevation × moisture.
- Save/gallery, accounts, any backend or database.
- Tutorial prose beyond stage labels; narration audio; localized UI.
- User-defined presets, settings pages.
- Mobile-first redesign beyond basic responsiveness.

## Primary Journeys

1. **First visit / wow:** land on deployed URL → default preset auto-generates with full staged animation → visitor sees within seconds that terrain = elevation + moisture + biomes.
2. **Tinker loop (core):** drag elevation/moisture sliders → map updates instantly at biome view. Debounced, never blocked.
3. **Explore seeds:** 🎲 → animation replays with new terrain → repeat.
4. **Preset hop:** click a preset → controls jump, map regenerates animated (Generate-class change).
5. **Share:** copy URL → friend opens → same map reproduces.
6. **Keep:** Export PNG downloads the map.

## Important States

- **Idle** (map shown) / **Generating-Animating** (worker computing; stages progressing; skippable; input cancels) / **Instant-updating** (slider debounce) / **Error** (worker failure → friendly error + retry, never white screen).
- Reduced-motion path: skip straight to final map.

## Success Measures

1. Slider input during generation shows **no perceptible jank** (input-to-paint within one worker round-trip).
2. **Same URL → identical map output** (determinism).
3. **Two humans can describe the three stages unprompted** after one watch.

*Lighthouse demoted to nice-to-have, not a measure.*

## Acceptance Criteria

- Hand-written noise; no noise-generation dependency.
- All pixel/noise computation in a Web Worker.
- Elevation, moisture, seed each demonstrably alter the map.
- Three distinguishable animated stages; instant updates on slider input; skip works; mid-animation input cancels cleanly.
- First load auto-generates with animation; reduced-motion respected.
- 3 presets, URL-state reproduction, PNG export all functional.
- Deployed to a public static URL.
- Worker failure → friendly error + retry (no main-thread fallback in v1 unless research shows real Safari worker issues).

## Constraints

- Noise math in a Web Worker — non-negotiable.
- No backend; static hosting; modern evergreen browsers incl. Safari.

## Assumptions

- ~512×512-class resolution suffices to look great (verify in research).
- Free static hosting exists (GitHub Pages-class).
- Stack preference (TS + Vite, no framework, GH Pages) holds up to research verification.

## Risks

- Animation pacing: too slow annoys, too fast teaches nothing (owner: planning).
- Safari/worker edge cases; low-end device performance (owner: research).
- Preset tuning rabbit-hole (contained: 3 fixed presets).
- v1 is chunky — **descope path approved:** defer share/export (never the animation or worker) if production runs long.

## Role Perspectives

*(Meeting record; resolutions noted.)*

### Product / User Value
- **Supports:** staged reveal is the differentiator; tinker loop is retention.
- **Dissent:** "teaching" vs "not a curriculum" — resolved: teaching-by-revealing, labels only.
- **Resolved:** stage labels are the only teaching affordance in v1. ✅

### UX / UI
- **Dissent:** animation-vs-input conflict — resolved: skip affordance + input-cancels-animation; 2.5–4s budget → planning.
- **Resolved:** one-screen layout, no settings page. ✅

### Frontend
- **Dissent:** slider semantics (the architecture decision) — resolved: **hybrid** (elevation = recompute, moisture = reclassify, seed = animated regen).
- **Resolved:** transferable ArrayBuffers, main-thread `putImageData` as safe baseline (OffscreenCanvas optional). Worker timing experiment → research. ✅

### Backend / Data / Integrations
- None needed; URL must carry full control state. ✅

### Quality / Reliability
- **Resolved:** worker failure = friendly error + retry in v1; main-thread fallback only on evidence. ✅

### Security / Privacy
- Static site, no PII. Sanitize URL params on read; tiny dependency tree. ✅

### Accessibility
- Native sliders (keyboard); luminance-separated palette + grayscale stage (color-blind friendly); `prefers-reduced-motion` skips animation; stage announcements via `aria-live`. Palette luminance check → research. ✅

### Domain / Content Accuracy (biomes)
- Directional check: elevation × moisture crosswalk mirrors the Whittaker-diagram approach (Red Blob Games-style). Stylized RPG abstraction, not climate simulation. Exact biome table + palette → research with citations. ✅

## Open Questions — Final Disposition

| # | Question | Owner | Blocks? | Status |
|---|---|---|---|---|
| 1 | Slider semantics | town-hall | — | **resolved: hybrid** |
| 2 | Tech stack | research | blocks production | open (preference: TS+Vite, no framework) |
| 3 | Noise choice (simplex vs perlin, octaves) | research | blocks production | open |
| 4 | Canvas resolution (fixed vs responsive, size) | research | blocks production | open |
| 5 | Animation timings/easings/skip mechanics | planning | informs production | open |
| 6 | Deploy target | research | blocks production (mildly) | open (preference: GH Pages) |
| 7 | Worker failure mode | research → production | informs production | **resolved: error+retry**, revisit only on Safari evidence |
| 8 | Biome table + palette | research | blocks production | open |

## Decisions

1. **Hybrid slider semantics** — elevation reshapes terrain character (debounced worker recompute, no animation); moisture biases classification (instant, no recompute); seed/new-seed = full animated regen. *Rejected:* full-recompute-everything (needlessly slow for moisture), threshold-only elevation (feels like a dimmer switch, not raising mountains).
2. **All three extras in v1, contained** — 3 fixed presets, hash-state share, PNG export. *Rejected:* cutting share/export (each is small precisely because there's no backend). Descope path recorded if production runs long.
3. **Animate on Generate-class changes only** — slider input cancels animation and jumps to instant mode; skip affordance; 2.5–4s budget. *Rejected:* always-animate, user toggle, disabling inputs during animation.
4. **Seed = input + 🎲 button**, not a slider (huge unordered space). Deviation from brief's literal wording, approved.
5. **First load auto-generates with the animation**; reduced-motion users get the final map immediately. *Rejected:* empty state + Generate button.
6. **Labels:** `Elevation` → `Moisture` → `Biomes`. **Title:** "Procedural Biome Generator" (searchable, literal). *Rejected:* punny names for v1.
7. **Success measures:** 3 concrete, testable measures; Lighthouse demoted. *Rejected:* unfalsifiable "Lighthouse-ish" and untested vibes.
8. **Worker failure = friendly error + retry** in v1; no silent main-thread fallback. *Rejected:* always-on fallback (doubles testing surface, hides bugs).
9. **Stack preference (not commitment):** TypeScript + Vite, vanilla DOM/canvas, GitHub Pages — user has no attachment; research verifies.
10. **Public deployment is part of done.** *Rejected:* local-only.

## Cluster Sign-offs

| Cluster | Round | Status |
|---|---|---|
| Problem & users | 1 (Q1) | ✅ signed off |
| MVP boundary & non-goals | 1 (Q2–Q4, Challenger/Advocate) | ✅ signed off |
| Journeys, states, success measures & acceptance criteria | 1 (Q5–Q6) + 2 (Q1) | ✅ signed off |
| Constraints, assumptions, risks | 1 (Q1) | ✅ signed off |
| Open-question disposition | 1 (Q7, Challenger/Advocate on #7) | ✅ signed off |

## Handoff Note for plan-it-out

Approved scope: the MVP above — nothing more. Planning must structure (role-organized, dependency-aware, bite-sized tasks): noise module (pure, testable), worker protocol, field caching/reclassification path (moisture instant), debounced recompute path (elevation), staged animation controller (~2.5–4s, skip, input-cancel, reduced-motion), UI (canvas + controls + 3 presets), URL-hash state, PNG export, deploy pipeline. Reserved for research (do not decide in planning): tech stack verification, simplex-vs-perlin + octave params, canvas resolution, deploy target, biome table + luminance-checked palette. Animation timings/easings belong to planning but are tunable in production. The descope path (defer share/export) requires going back through Ultron change control if invoked.
