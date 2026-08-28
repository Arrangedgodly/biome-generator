# Plan — Procedural Biome Generator

Status: **REVISED after research — awaiting whole-plan re-approval** (D2 added preview-path content to T3/T6; per deep-research gate, task changes require whole-plan approval before production)
Source scope: `docs/ultron/town-hall.md` (approved 2026-08-26). Research decisions: `docs/ultron/research/` (all committed 2026-08-26).

## Committed decisions from research (D1–D5, all ✅ committed 2026-08-26)

| ID | Decision | Record |
|---|---|---|
| D1 | **2D Simplex** (Gustavson 2005 public-domain port); fBm **5 octaves / lacunarity 2.0 / gain 0.5**; golden-value (1e-10) + statistical tests; elevation shaping `pow ~1.5` + island falloff; moisture = different seed, 2–3 octaves | `research/rq1-noise.md` |
| D2 | **Fixed 512² internal res**, CSS-scaled `pixelated`; **256² drag preview → 512² on release**; animation via pre-composed stage frames + `globalAlpha` crossfade; palette LUT; alpha 255; no visible-canvas readback | `research/rq2-resolution-performance.md` |
| D3 | **12-biome elevation-first table** (sea level 0.40; moisture bands 0.25/0.50/0.75) + committed hex palette, ΔL ≥ 0.08 adjacency rule (incl. deuteranopia sim), tunable threshold constants | `research/rq3-biome-palette.md` |
| D4 | **TypeScript + Vite 8 vanilla-ts confirmed**; GitHub Pages via Actions; `base: '/<repo>/'` from day one; `new Worker(new URL(...), {type:'module'})` pattern | `research/rq4-stack-hosting.md` |
| D5 | **No main-thread fallback**; pin `worker.format: 'iife'`; posted buffers are dead-on-post (detach invariants); terminate+recreate on retry | `research/rq5-safari-workers.md` |

## Fixed by scope (not open for planning decisions)

- Hybrid control semantics: elevation = debounced worker recompute (terrain character); moisture = instant reclassification; seed / 🎲 / preset / Generate = full animated regeneration.
- Hand-implemented noise; no noise-generation dependency; all noise math in a Web Worker.
- Staged animation `Elevation` → `Moisture` → `Biomes`, ~2.5–4s, skippable, mid-animation input cancels to instant mode; first load auto-animates; `prefers-reduced-motion` skips.
- Seed = text/number input + 🎲 button. Exactly 3 fixed presets. URL-hash full state. PNG export. Public static deploy. Worker failure = friendly error + retry.
- A11y baseline: native sliders, `aria-live` stage announcements, luminance-separated palette.

## Lanes and tasks

Task schema: **ID — owner role · outcome · status · scope & journey · inputs → outputs · deps · surfaces · acceptance & validation · risks · size.** All research gates resolved; statuses below reflect that.

### Lane A — Frontend, core engine

**T1 — Frontend · Project scaffold**
- Status: `completed` (approved 2026-08-27).
- Outcome: runnable app shell with dev server, TS strict mode, git repo initialized, empty canvas page.
- Scope: `npm create vite@latest -- --template vanilla-ts` (Vite 8.x, Node 20.19+/22.12+); keep `vite-env.d.ts`; set `base: '/<repo>/'` day one; pin `worker.format: 'iife'`; worker file as plain TS with ESM imports.
- Deps: none (first). Parallel with: nothing.
- Acceptance: dev server starts, page renders, typecheck + build pass. Validation: build exits 0.
- Size: **small**.

**T2 — Frontend · Noise module (pure)**
- Status: `completed` (approved 2026-08-27).
- Outcome: `simplex2D(x, y, seed)` ported from Gustavson 2005 (512-entry seeded perm table, F2/G2 constants, 70× scale) + `fbm2D(x, y, {octaves: 5, lacunarity: 2, gain: 0.5, baseFreq, seedOffset})` with Σ-amplitude normalization and per-octave seed offsets.
- Scope: math only, no worker/DOM. D1-fallback documented: improved Perlin with identical scaffolding if the port stalls.
- Deps: T1. Parallel with: T4.
- Acceptance: golden values (~16 snapshots, seed 0, tol 1e-10); mean ≈ 0 (±0.02 @512² grid); bounded; continuity; same seed ⇒ byte-identical output. Validation: unit suite green.
- Size: **medium**.

**T3 — Frontend · Field generation pipeline (pure, worker-ready)**
- Status: `completed` (approved 2026-08-27, deviation accepted).
- Outcome: `generateFields(seed, params, resolution)` → `{elevation, moisture: Float32Array}`. Elevation = fBm(baseFreq 3–4, 5 oct) → `pow ~1.5` redistribution → island falloff blend → normalize [0,1]. Moisture = fBm(different seed, baseFreq 2–3, 2–3 oct) → normalize. **Resolution parameter: 512 final, 256 preview** (D2).
- Scope: pure functions + one tunable config object (all thresholds/frequencies exposed for preset tuning).
- Deps: T2. Parallel with: T4.
- Acceptance: same inputs ⇒ identical arrays (hash test); normalized [0,1]; works at both resolutions. Validation: unit tests.
- Size: **medium**.

**T3b — Frontend · Elevation range normalization + preset recalibration** *(inserted 2026-08-27 after coordinator browser check; fixes dead mountain/snow bands — max elevation 0.859 < 0.88 snow threshold)*
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: `docs/ultron/production-log.md` T3b entry).
- Outcome: all 12 biomes reachable through the real `generateFields` pipeline. Percentile range-normalization appended to the elevation shaping (post-falloff/post-pow): single-histogram-pass bounds, `[2nd, 99.95th]` percentile span remapped to [0,1] clamped (new `FieldParams` knobs `elevationNormLow`/`elevationNormHigh`, pure function of the field → determinism preserved). Presets recalibrated: archipelago falloff 0.35 → 0.7 (normalization had inflated it to ~21% land), highlands gains `elevationNormHigh: 0.99` override (mountain ≥ 2%, snow ≥ 0.5%); biome table, fBm defaults, and `generateFields` signature untouched.
- Deps: T3 (and consumes T12 presets). Parallel with: nothing (fix task).
- Acceptance: biome-fraction calibration at 512² × 8 seeds mirroring the controller merge — defaults ocean 0.45–0.75 with every biome ≥ 0.1%, mountain > 0.05%, snow ∈ (0, 2%); continent one landmass + all 12 ≥ 0.1%; archipelago land 3–15% with mountains present; highlands land ≥ 35%, mountain ≥ 2%, snow ≥ 0.5%, tundra ≥ 0.5%. Regression tests added (reachability at defaults across 4 seeds + highlands/archipelago preset merges + normalization determinism at 256²). Validation: vitest + measurement table in the production log.
- Size: **small**.

**T3c — Frontend · Snow/mountain ratio + land coherence calibration** *(inserted 2026-08-27 after coordinator visual sign-off; fixes snow/mountain inversion + land coherence)*
- Status: `completed` (auto-approved (ultron-supreme) 2026-08-27. History: T3c verified with every claimed measurement reproduced but 2 defects → `needs-fix`; T3c-fix (stale comment + `bareBootState()` bare-boot + F1 seed 404) re-verified 2026-08-27 — defects resolved at source, first load now IS the calibrated continent config (boot s0: mtn 0.420 ≥ snow 0.406, coherence 55.8%), the coherence guard bites directly on the `elevationFreq` mutation, 204/204 + typecheck 0 + build 0, worker chunk byte-identical, calibration values untouched; evidence in `docs/ultron/production-log.md` T3c Verification + T3c-fix + re-Verification entries).
- Outcome: snow ≤ mountain at EVERY seed (512², 8 seeds, defaults + continent + highlands; archipelago snow ≤ 0.5% absolute); largest 4-connected land component ≥ 55% of land at EVERY seed for continent AND highlands; all T3b floors kept. Mechanism verified: the mountain biome gets only the DRY half of the [0.80, 0.88) band (conditional dry share 0.38–0.44) while snow takes the entire ≥ 0.88 region — the 0.9995 top shoulder left enough mass above 0.88 to invert the ratio. Fix is parameters only: default `elevationNormHigh` 0.9995 → 0.99999 (near-max stretch), default `falloffStrength` 0.03 → 0.0 (the falloff's d-gradient fattens the normalized snow tail), preset recalibration with a sanctioned `elevationFreq` allowlist extension (continent freq 2.72 / slider 0.3; highlands freq 1.5 / slider 0.75 / falloff 0.06 / drier moisture 0.15; archipelago `elevationNormHigh` 0.9998). T6 slider mapping untouched for manual use; biome table, band thresholds, fBm defaults, `generateFields` signature, palette unchanged; determinism re-verified byte-identical with interleaved generations.
- Deps: T3b (and consumes T12 presets). Parallel with: nothing (fix task).
- Acceptance: 8-seed per-seed tables (ratio + coherence + land + biome floors) in the production log; regression tests (per-seed ratio defaults/continent/highlands + archipelago snow cap; per-seed coherence ≥ 55% at 256² with resolution-stability verified 128/256/512 ≤ 0.4pp). Validation: vitest + visual before/after PNG pass.
- Size: **small**.

**T4 — Frontend · Biome classifier (pure)**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T4 entry).
- Outcome: `classify(e, m, {seaLevelBias, moistureBias}) → biomeId` implementing D3's 12-biome elevation-first table; biome metadata (name, hex, luminance rank); thresholds as tunable constants.
- Deps: T1. Parallel with: T2, T3.
- Acceptance: boundary-value matrix test over all bands; biases demonstrably shift classification. Validation: unit tests.
- Size: **small**.

**T5 — Frontend · Worker + message protocol**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T5 entry).
- Outcome: map worker exposing `generate` (full fields) and `recompute` (elevation-only), returning transferable `Float32Array`s (512² and 256² both supported); typed error messages; latest-wins cancellation.
- Scope: protocol + worker host. **D5 invariants:** fresh buffer per request; posted buffers never touched again (detached-check guards); `terminate()` + recreate on retry; classic/iife-compatible.
- Deps: T3. Parallel with: T7.
- Acceptance: main thread never computes noise; rapid requests yield only the final result; worker error surfaces as typed message; buffer-detach guards proven. Validation: integration harness spamming requests.
- Size: **medium**.

**T6 — Frontend · Update controller (main thread)**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T6 entry).
- Outcome: routes the three semantics — moisture → local reclassify (no worker); elevation → debounced worker recompute **with D2 preview path: 256² while dragging, 512² regen on `change`/pointer-up**; seed/Generate/preset → animated regen. Owns field cache + animation cancel.
- Deps: T5, T7. Parallel with: T8.
- Acceptance: moisture drag never trips the worker; elevation drag coalesces bursts (preview ≤ ~30ms debounce); Generate-class event mid-animation cancels cleanly. Validation: instrumented worker-message counts + manual harness.
- Size: **medium**.

### Lane B — Frontend, rendering & animation

**T7 — Frontend · Canvas renderer**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T7 entry).`
- Outcome: paint from cached fields in three modes (grayscale elevation / moisture overlay / full biomes) via **palette LUT** (elevation×moisture → biome color table); cached offscreen canvases per mode; alpha always 255; never `getImageData` on the visible canvas.
- Scope: pixels only, no timing. Canvas: single fixed 512² element, CSS-scaled, `image-rendering: pixelated` + `crisp-edges` fallback (D2).
- Deps: T4. Parallel with: T5.
- Acceptance: three modes correct; LUT classification fast enough for chunked composition <8ms/task. Validation: dev harness cycling modes.
- Size: **medium**.

**T8 — Frontend · Staged animation controller**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T8 entry).
- Outcome: choreography `Elevation` → `Moisture` → `Biomes`: pre-composed stage frames crossfaded via `drawImage` + `globalAlpha` (GPU-composited); per-stage duration/easing in one config object; skip affordance; mid-animation input cancel; reduced-motion bypass; `aria-live` stage announcements.
- Deps: T7, T6. Parallel with: T9.
- Acceptance: total 2.5–4s default; skip → final frame <100ms; cancel without artifacts; reduced-motion → immediate final map; announcements fire per stage. Validation: manual matrix (normal/skip/cancel/reduced-motion).
- Size: **medium**.

**T9 — UI/Visual · Palette application & polish**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T9 entry).
- Outcome: apply D3 palette; canvas presentation; responsive single-screen layout down to ~375px.
- Deps: T7. Parallel with: T8.
- Acceptance: automated ΔL ≥ 0.08 adjacency test passes; grayscale ordering check; Coblis/Sim Daltonism screenshot verified; optional Beach knob `#d8c790`. Validation: unit test + manual checks.
- Size: **small**.

### Lane C — UI & interaction

**T10 — UI · Controls & error surface**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T10 entry). Post-approval follow-up "call `client.terminate()` on the dropped worker during rebuild (rq5 terminate-before-recreate hygiene)" — long open, quantified by T16 B6 (11 workers alive after 9 constructions) — **resolved by T16-fix (2026-08-27): `MapController.dispose()` now terminates the worker client via an internal `onDispose` hook wired in `createMapController`; see `docs/ultron/production-log.md` T16-fix entry.**'
- Outcome: elevation slider, moisture slider, seed input + 🎲, Generate button, 3 preset buttons, export & share buttons — wired to controller. Worker failure → friendly error + Retry (recreate worker, resend params). Pin `worker.format: 'iife'` (config-level, D5).
- Deps: T6. Parallel with: T8, T9.
- Acceptance: native range inputs (keyboard-operable); error reachable via worker-kill test, retry works; `onerror`/`onmessageerror` handled. Validation: keyboard-only walkthrough + worker-kill harness.
- Size: **medium**.

**T11 — Frontend · First-load experience**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T11 entry).
- Outcome: on load — restore URL state if present (then animate), else default preset auto-generates with staged animation; reduced-motion respected.
- Deps: T8, T13. Parallel with: T14.
- Acceptance: bare URL → animated default map; stateful URL → identical map; reduced-motion → immediate final map. Validation: three URL cases in dev.
- Size: **small**.

**T12 — Product/UX · Presets**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T12 entry).
- Outcome: Archipelago, Continent, Highlands as fixed snapshots (field-shaping params via T3's config + slider positions); click applies controls + animated regen.
- Deps: T3, T10. Parallel with: T13.
- Acceptance: three visibly distinct terrain characters (user signs off on look); no user-defined presets. Validation: side-by-side screenshots + user review.
- Size: **small**.

### Lane D — State, share, export

**T13 — Frontend · URL-hash state**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T13 entry).
- Outcome: serialize/deserialize full control state (seed, sliders, preset, biases) to/from URL hash; sanitize on read; include state version field; hash updates without history spam.
- Deps: T10 types. Parallel with: T12, T14.
- Acceptance: round-trip identical; malformed hash → defaults (no crash); replaceState-based updates. Validation: unit tests (round-trip, malformed).
- Size: **small**.

**T14 — Frontend · Share + Export**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: docs/ultron/production-log.md T14 entry).
- Outcome: share button copies URL (clipboard fallback: select URL); export downloads PNG via `canvas.toBlob` + download attribute.
- Deps: T13, T7. Parallel with: T11.
- Acceptance: copied URL reproduces identical map on fresh load; PNG matches canvas. Validation: manual round-trip.
- Size: **small**.

### Lane E — QA / validation

**T15 — QA · Determinism & regression suite**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27; evidence: `docs/ultron/production-log.md` T15 + T15 Verification entries).
- Outcome: consolidated automated suite: noise golden values + statistics, field-hash determinism, URL round-trip, classifier boundary matrix, palette ΔL adjacency. Verified as a coherent whole: the four behavioral legs already existed (T2/T4/T9/T13-owned, audited in place); the missing field-hash leg was added to `fields.test.ts` as a pinned byte-level digest grid (seed × params × resolution: defaults + highlands preset + bare-boot continent @ 512² — the normalization-on case, closing verifier follow-up F2 — plus defaults @ 256² preview; moisture hashed alongside elevation) with interleaved-generation isolation, consolidating the two former same-inputs-twice property tests (128²/256²) into strictly stronger coverage.
- Deps: T2, T3, T13. Parallel with: T16 prep.
- Acceptance: suite green (204/204); deliberate mutation (one octave changed) fails the hash test — verified: `elevationOctaves` 5→4 fails the pinned-digest test first (plus the interleaved test and 3 behavioral tests), restored byte-identically (build asset hashes identical pre/post). Validation: test run + mutation check (recorded in the production log).
- Size: **medium**.

**T16 — QA · Performance & jank validation**
- Status: `completed` (verified + auto-approved (ultron-supreme) 2026-08-27 · executed 2026-08-27 · Delegation: none — production worker in the Ultron-Supreme run, coordinator-briefed; evidence: `docs/ultron/production-log.md` T16 entry + T16 Verification entry + `docs/ultron/evidence/t16/`). All D2 budgets measured PASS on Chromium (native + 4× CPU throttle + Pixel-7 emulation) and WebKit/JSC (desktop + iPhone-13 emulation); zero main-thread longtasks during drag+animation anywhere; no production-code changes required. Verifier independently re-ran all gates (204/204, typecheck 0, build 0, byte-identical T15 assets, zero playwright residue), cross-checked every budget table cell against the evidence JSONs and both DevTools traces, re-measured 512² generate in raw Node (median ~78 ms vs 300 budget), and confirmed the two routed non-perf findings (skip-button enable-after-done; one live worker leaked per retry/rebuild) as real with exact source-level diagnoses — see T16 Verification for the fix-dispatch guidance. Real-device Safari / mid-Android spot-checks routed to T17's human checklist (browser automation cannot reach them in this environment). **Follow-up list resolved by T16-fix (2026-08-27): both adjudicated defects fixed along the verifier's directions — F1 settle-before-done-announce in `StagedAnimation` (Skip now disables after normal completion and skip); F2 worker terminate wired through `MapController.dispose()` (retries/rebuilds leak zero live workers; also closes T10's terminate-hygiene clause). 213/213 tests, new entry hash `index-BaLHBJm7.js`, worker chunk byte-identical; evidence: `docs/ultron/production-log.md` T16-fix entry. Fix RE-VERIFIED by the T16 verifier (2026-08-27): source orderings confirmed, gates re-run 213/213/typecheck 0/build 0 with the exact hash picture, both mutation probes (revert settle-order; remove onDispose wiring) reproduced the original defects and were reverted byte-exactly, disclosed residual adjudicated unreachable-and-harmless — see `docs/ultron/production-log.md` T16-fix Re-verification entry.**
- Outcome: evidence for success measure #1 per D2 budgets: no main-thread task >50ms during slider drag + animation; worker regen <100ms @256² / <300ms @512² mid-hardware; per-frame main JS <10ms during crossfades; Safari + mid Android tested explicitly.
- Deps: T6, T8. Parallel with: T15.
- Acceptance: DevTools performance recordings archived. Validation: recordings in production log.
- Size: **small**.

**T17 — QA · Human comprehension check**
- Status: `awaiting-user` (protocol prepared 2026-08-27 — runbook at `docs/ultron/t17-human-test-protocol.md`; fill-in results template at `docs/ultron/evidence/t17/t17-results.md`; Section B folds the 4 real-device items routed from T16's checklist).
- Outcome: success measure #3 evidence: two humans watch one generation, describe stages unprompted.
- Deps: T8, T9 + preview deployment or local. Parallel with: T18.
- Acceptance: both describe elevation/height, moisture/water-ish, biomes/colors concepts. Validation: responses recorded.
- Size: **small**.

### Lane F — DevOps

**T18 — DevOps · Static deploy**
- Status: `verified-prepared (awaiting user wizard-lane execution)` (2026-08-27 — workflow, README and user runbook delivered; external steps — repo creation, push, Pages enablement — are the USER's per the T18 wizard-lane halt; runbook: `docs/ultron/t18-deploy-runbook.md`; evidence: `docs/ultron/production-log.md` T18-prep entry. **Verified 2026-08-27 (ultron-supreme): deploy.yml, gates (213/213 · typecheck 0 · build 0 byte-identical) and file-touch audit all CLEAN, but 3 runbook defects (gh is NOT installed despite the runbook's claim; gh-variant Step 4 `{owner}` placeholder unresolvable at that ordering; smoke item 2 claims Generate makes "a new map" — Generate replays the identical deterministic map) + 1 stale README fact ("99.95th" → 99.999th percentile, T3c moved the default to 0.99999) → needs-fix, doc-only repairs; specifics in `docs/ultron/production-log.md` T18-prep Verification entry. Fixed 2026-08-27 (T18-prep-fix): all 4 defects + the optional git-identity prerequisite note applied (runbook + README only — no code/workflow/config touched); every corrected fact re-verified against the tree; gates re-certified 213/213 · typecheck 0 · build byte-identical (`index-BaLHBJm7.js` / `map.worker-DbpHG_aw.js` / `index-BcTqoKYm.css`) — see `docs/ultron/production-log.md` T18-prep-fix entry. **Re-verified by the original verifier (2026-08-27): PASS — fix accepted**; all six edits confirmed at source (smoke item 2 now states the app's real Generate/dice behavior exactly; the 99–129 ms band is exact against all five evidence JSONs; the two remaining "99.95"/"78ms" hits are intentional historical/corrected citations), zero new stale facts, gates re-run 213/213 · typecheck 0 · build byte-identical, fix-window touch audit = exactly the four disclosed doc files — see `docs/ultron/production-log.md` T18-prep Re-verification entry).**
- Outcome: GitHub Pages via Actions per D4: Settings → Pages → Source: GitHub Actions; workflow = checkout → setup-node (lts, npm cache) → `npm ci` → `npm run build` → configure-pages → upload-pages-artifact (`dist`) → deploy-pages; permissions `contents: read`, `pages: write`, `id-token: write`.
- Deps: T1. Parallel with feature work once scaffold exists (deploy previews early).
- Acceptance: public URL serves latest build; deterministic rebuild. Validation: URL fetch + content check.
- Size: **small**.

## Dependency-ordered task index (authoritative)

| # | Task | Status | Deps | Size | Research gate |
|---|---|---|---|---|---|
| 1 | T1 scaffold | ✅ completed | — | small | resolved (D4) |
| 2 | T2 noise | ✅ completed | T1 | medium | resolved (D1) |
| 3 | T4 biomes | ✅ completed | T1 | small | resolved (D3) |
| 4 | T3 fields | ✅ completed | T2 | medium | resolved (D1, D2) |
| 4b | T3b elevation range fix | ✅ completed | T3 | small | — (post-T3 defect fix) |
| 4c | T3c snow/mountain + coherence | ✅ completed (T3c-fix re-verified) | T3b | small | — (post-T3b taste fix) |
| 5 | T7 renderer | ✅ completed | T4 | medium | resolved (D2, D3) |
| 6 | T5 worker | ✅ completed | T3 | medium | resolved (D5) |
| 7 | T6 controller | ✅ completed | T5, T7 | medium | resolved (D2) |
| 8 | T10 controls | ✅ completed (terminate-hygiene follow-up resolved by T16-fix) | T6 | medium | resolved (D5) |
| 9 | T8 animation | ✅ completed | T6, T7 | medium | resolved (D2) |
| 10 | T9 polish | ✅ completed | T7 | small | resolved (D3) |
| 11 | T13 URL state | ✅ completed | T10 types | small | — |
| 12 | T12 presets | ✅ completed | T3, T10 | small | — |
| 13 | T11 first-load | ✅ completed | T8, T13 | small | — |
| 14 | T14 share+export | ✅ completed | T13, T7 | small | — |
| 15 | T15 tests | ✅ completed | T2, T3, T13 | medium | — |
| 16 | T16 perf | ✅ completed (routed defects F1+F2 fixed — T16-fix) | T6, T8 | small | resolved (D2) |
| 17 | T17 human check | ⏳ awaiting-user (protocol prepared) | T8, T9 | small | — |
| 18 | T18 deploy | 🟨 verified-prepared (awaiting user execution) | T1 | small | resolved (D4) |

Critical path: **T1 → T2 → T3 → T5 → T6 → T8 → T11 → ship** (unchanged).

## Milestones

- **M1 — Thin end-to-end slice:** T1–T5 minimal: seed → worker → fields → flat-color biome map on canvas. *Exposes the riskiest assumptions early: our simplex port is right, worker protocol holds.*
- **M2 — Steerable map:** T6, T7, T10: both slider semantics + seed input working; 256² preview path live; instant feel validated (T16 preliminary).
- **M3 — The show:** T8, T9, T11: staged animation with skip/cancel/reduced-motion, labels, first-load auto-generate. *The product's identity milestone.*
- **M4 — Full v1:** T12, T13, T14, T15: presets, share, export, consolidated tests.
- **M5 — Shipped:** T16, T17, T18: evidence recorded, public URL live, acceptance criteria checked with user.

## Traceability (scope → tasks)

| Scope item | Tasks |
|---|---|
| Hand-written noise, worker-only math | T2, T3, T5, T16 |
| Hybrid slider semantics (+ preview path) | T3, T6, T10 |
| Seed input + 🎲 | T10 |
| Staged animation + skip/cancel/reduced-motion | T7, T8, T11 |
| First-load auto-animate | T11 |
| 3 presets | T12 |
| URL-hash share | T13, T14 |
| PNG export | T14 |
| Deploy | T18 |
| Error+retry failure mode | T5, T10 |
| A11y (sliders, aria-live, luminance palette) | T4, T8, T9, T10 |
| Success measures 1/2/3 | T16 / T15 (+T13) / T17 |

## Handoff section

- **Proposed build order:** M1 thin slice T1→T2/T4→T3→T5/T7, then M2 interactivity (incl. preview path), M3 the show, M4 extras, M5 ship.
- **Fixed by scope:** see above. **From research:** D1–D5 committed table above.
- **Assumptions that return us to Town Hall if they break:** free static hosting suffices (verified D4 — safe); ~512² + `pixelated` looks good (visual check at M2/M3 — if it fails aesthetically, that's a production-level tuning matter unless it changes UI scope); invoking the descope path (defer share/export) is a change-control event.
- **Plan revision requiring whole-plan approval:** D2's dual-resolution preview added content to T3 (resolution param) and T6 (preview path + release-regen). No acceptance criteria, scope items, or milestones changed. Approve the revised plan as a whole to enter production.

## Sizing note

18 tasks: 12 small, 6 medium, none split-required. Watch tasks: T6 (controller — rendering-free, now includes the preview path) and T8 (animation — taste isolated in a config object). Descope path unchanged: defer share/export only, via change control.
