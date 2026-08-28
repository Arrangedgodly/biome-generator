# RQ2 — Resolution, fixed/responsive, compute & frame budgets

Affects: T3 (fields), T7 (renderer), T8 (animation), T16 (perf validation) · Priority: P0 · Status: ✅ **committed 2026-08-26** (user approved recommended option)

## Question

What canvas resolution balances crispness vs worker compute on mid-range hardware (incl. Safari)? Fixed or responsive? What per-frame animation budget is safe?

## Constraints / evaluation criteria

Mid-range hardware baseline; Safari included; success measure = no perceptible jank while dragging during generation (no main-thread long tasks >50ms); determinism: same URL → identical map (regardless of device!).

## Options considered

1. **Fixed 512² internal, CSS-scaled, dual-res interactive preview** — ✅ recommended (below).
2. **384² everywhere** — ~20–70ms mid-hardware regen, single-resolution simplicity; slider latency still marginal on phones. Fallback if dual-res feels complex.
3. **Per-frame ImageData blending at 512²** — possible but marginal on mid phones/Safari; keep only as opt-in effect path (30fps-capped, stripe-chunked, palette-LUT blended).
4. **768² / DPR-responsive** — 0.3–0.6s regen, 2.25MB uploads; "HQ export" territory only. Rejected for interactive use; DPR-responsive also **breaks URL determinism** (different pixel spacing per device).

## Recommendation

**Fixed internal resolution 512×512, CSS-scaled with `image-rendering: pixelated` (+ `crisp-edges` fallback). Interactive slider preview at 256²; full 512² regen on `change`/pointer-up.**

### Compute budget (2 fields × 5 octaves)

| Path | Noise calls | Est. time |
|---|---|---|
| 512² full regen | 2.62M | ~75–150ms mid laptop, ~150–300ms mid phone (36ms high-end desktop) |
| 256² drag preview | 655k | ~9–30ms mid laptop, ~40–70ms mid phone |

With ~30ms debounce, 256² preview lands end-to-end under ~100ms — inside RAIL's visible-response target, zero main-thread long tasks (compute is worker-side; main thread does a 256KB `putImageData`, ~0.3–1ms).

### Animation frame strategy

Compose each render mode **once** into cached offscreen canvases (grayscale / moisture / biome = 3 `putImageData` total, ~1–3ms each, chunked across rAF ticks with each task <8ms), then crossfade by drawing two cached canvases with `globalAlpha` — GPU-composited (Safari 17 moved canvas 2D to the GPU process), ~sub-ms CPU, 60fps everywhere. Per-frame per-pixel ImageData recomposition is the rejected-expensive path.

**Hard requirements:** classification via elevation×moisture → palette LUT (not per-pixel branching — a naive classifier is 3–5× slower); alpha always 255 (opaque fast path); never `getImageData` on the visible canvas (software-rendering demotion risk).

## Evidence

- simplex-noise.js v4.0.3 README — 72.9M noise2D ops/s on Ryzen 5950X (~14ns/call); mid-range figures derived with a flagged 2–7× factor. https://github.com/jwagner/simplex-noise.js
- MDN putImageData (alpha-premultiplication cost) https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/putImageData · schiener.io (2024-08-02) `willReadFrequently` software-demotion https://www.schiener.io/2024-08-02/canvas-willreadfrequently
- WebKit blog, Safari 17.0 — canvas 2D in GPU process (drawImage/globalAlpha is the Safari-friendly path). https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
- MDN crisp pixel art (`pixelated` upscale pattern) https://developer.mozilla.org/en-US/docs/Games/Techniques/Crisp_pixel_art_look
- web.dev RAIL (100ms visible response; 50ms long-task threshold) https://web.dev/articles/rail · canvas performance (pre-render + blit) https://web.dev/articles/canvas-performance
- dumbmatter.com OffscreenCanvas pain points (2022-11) — worker rAF/OffscreenCanvas caveats; our Float32Array-worker design doesn't need OffscreenCanvas. https://dumbmatter.com/2022/11/offscreencanvas-pain-points/

## Tradeoffs / risks / confidence

Strategy (LUT, precomposed endpoints, fixed res): **high**. Absolute timings: **medium** (Chrome-centric benchmarks; T16 must measure, esp. Safari + mid Android). Visual: 512² upscaled ~1.4–1.8× reads as intentional chunky style with `pixelated`; ~3× on 2× retina — verify visually in T9. Fixed resolution is **required** for URL determinism.

## Implementation consequences

- **T3:** worker API takes a resolution parameter; 512² final, 256² preview; transfer Float32Arrays (never structured-clone ImageData).
- **T7:** single fixed 512² canvas, CSS-scaled; LUT classification; alpha 255; no visible-canvas readback.
- **T8:** pre-compose 3 mode frames on field arrival (chunked, <8ms tasks); crossfade via `drawImage` + `globalAlpha`; per-frame blending only as opt-in 30fps effect path.
- **T16:** assert no main-thread task >50ms during drag + animation; worker regen targets <100ms @256², <300ms @512² mid-hardware; test Safari + mid Android explicitly.
- **Plan delta:** T3/T6 gain preview-path content (256² on drag, 512² on release). Outcome/acceptance unchanged.
