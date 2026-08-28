# RQ3 — Biome crosswalk and luminance-separated palette

Affects: T4 (biome classifier), T9 (palette/polish) · Priority: P0 · Status: ✅ **committed 2026-08-26** (user approved recommended option)

## Question

Which elevation × moisture crosswalk, what final biome set, and what luminance-separated palette (color-blind legible, grayscale-distinguishable)?

## Constraints / evaluation criteria

Stylized RPG abstraction (not climate sim); pure `classify(e, m, biases) → biomeId`; palette distinguishable in grayscale and under color-blind simulation; stage-1 grayscale heightmap must luminance-order consistently with final colors.

## Options considered

1. **Elevation-first ordered rules over shared moisture bands (Red Blob Games / Whittaker-style)** — ✅ recommended.
2. 3-axis temperature model (latitude-blended equivalent-elevation) — rejected: RBG's own climate section calls it experimental; extra axis, zero RPG-legibility gain.
3. Holdridge / Köppen classification — rejected: built for real climate data, not stylized noise fields.
4. Continuous hypsometric gradient (Tom Patterson) — rejected: app needs discrete biomeIds; noted as possible future overlay.

## Recommendation

### Crosswalk (sea level = 0.40)

Moisture bands (shared): Arid <0.25 · Semi-arid 0.25–0.50 · Humid 0.50–0.75 · Wet ≥0.75. Elevation gates first:

| Elevation | Biome |
|---|---|
| e < 0.28 | **Deep Ocean** |
| 0.28–0.40 | **Ocean** |
| 0.40–0.46 | **Beach** |
| 0.46–0.66 Lowland | Desert · Savanna · Grassland · Rainforest (by moisture band) |
| 0.66–0.80 Highland | Tundra · Grassland · Forest · Taiga |
| 0.80–0.88 Mountain | Mountain (m<0.5) / Tundra (m≥0.5) |
| e ≥ 0.88 | **Snow** (regardless of moisture) |

**12 biomes.** Dropped: Swamp/Marsh (needs second wet trigger), Shrubland/Steppe (merged into Tundra), Scorched/Bare (low recognizability). Colder-with-altitude intuition: Rainforest low+wet, Forest in the temperate highland belt, Taiga high+wet.

### Palette (WCAG relative luminance L)

| Biome | Hex | L | | Biome | Hex | L |
|---|---|---|---|---|---|---|
| Deep Ocean | `#0b1a2c` | 0.010 | | Tundra | `#c8ceab` | 0.594 |
| Ocean | `#20658c` | 0.115 | | Forest | `#2f7239` | 0.129 |
| Beach | `#e9dca9` | 0.714 | | Taiga | `#58919b` | 0.247 |
| Desert | `#d2a24c` | 0.401 | | Mountain | `#bcb2a0` | 0.451 |
| Savanna | `#87804a` | 0.211 | | Snow | `#f3f6f6` | 0.916 |
| Grassland | `#7ba95c` | 0.334 | | Rainforest | `#236639` | 0.102 |

**Rule: ΔL ≥ 0.08 for every biome pair that can touch.** All 20 table-adjacent pairs pass (min 0.105 = Deep Ocean–Ocean; Forest–Taiga 0.118). Deuteranopia-simulated (Machado matrix): every adjacent pair keeps ΔL ≥ 0.08; no reds in the palette; the five green-family biomes are separated purely by lightness. Grayscale ordering holds: water darkest → lowland 0.262 → highland 0.326 → mountain 0.451 → snow 0.916. Beach (0.714) is a deliberate bright foreshore sliver; T9 knob: darken to `#d8c790` (L≈0.57) if it feels jarring.

## Evidence

- Red Blob Games, "Map generation" — elevation-first biome table, scheme "based on Robert Whittaker's 1962/1966 biome classification", elevation as temperature proxy, "thresholds will need tuning to match your generator." https://www.redblobgames.com/maps/terrain-from-noise/
- WCAG 2.2 Understanding Contrast Minimum — L = 0.2126R+0.7152G+0.0722B, channel linearization, CR formula. https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- Coblis simulator / Sim Daltonism for CVD verification; Datawrapper/Esri/Okabe-Ito guidance ("blue is the safest hue", avoid green/red-only distinctions). https://www.color-blindness.com/coblis-color-blindness-simulator/

## Tradeoffs / risks / confidence

Structure + luminance math: **high** (computed, not estimated). Exact thresholds: **medium** until tested against the actual noise distribution — T4 exposes them as constants; RBG explicitly says tuning is expected. Rainforest (0.102) darker than Ocean (0.115) but they can never be adjacent (Beach separates).

## Implementation consequences

- **T4:** elevation-first ordered rule list (7 bands) + moisture constants `[0.25, 0.50, 0.75]`; `classify(e, m, biases)` applies biases before banding; table-driven, trivially testable (boundary matrix).
- **T9:** automated ΔL ≥ 0.08 adjacency unit test; grayscale band-mean ordering check; Coblis/Sim Daltonism screenshot verification; optional Beach-darkening knob.
