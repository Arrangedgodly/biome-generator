---
name: Procedural Biome Generator
description: Interactive biome-map generator with a staged, teaching reveal — quiet dark chrome around one loud, luminous map.
colors:
  surveyors-ocean: "#20658c"
  surveyors-ocean-bright: "#3d8ab8"
  night-sediment: "#111827"
  raised-sediment: "#1f2937"
  sediment-edge: "#374151"
  driftwood: "#e5e7eb"
  driftwood-muted: "#9ca3af"
  coral-warn: "#fca5a5"
  undertow: "#7f1d1d"
  undertow-edge: "#b91c1c"
  foam: "#ffffff"
typography:
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 650
    letterSpacing: "0.01em"
    lineHeight: 1.4
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
  body-secondary:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
  glyph:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1
  readout:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
spacing:
  xs: "0.5rem"
  sm: "0.875rem"
  md: "1rem"
  lg: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.surveyors-ocean}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.surveyors-ocean-bright}"
  button-quiet:
    backgroundColor: "{colors.night-sediment}"
    textColor: "{colors.driftwood-muted}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  input-seed:
    backgroundColor: "{colors.night-sediment}"
    textColor: "{colors.driftwood}"
    rounded: "{rounded.sm}"
    height: "2.5rem"
    padding: "0 0.625rem"
---

# Design System: Procedural Biome Generator

## Overview

**Creative North Star: "The Cartographer's Light Table"** *(scan-inferred; user confirmation pending)*

A dark workroom where one luminous map lies under examination. The instruments around it — sliders, seed, presets — are deliberately quiet: flat tonal surfaces, no shadows, muted labels, a single ocean accent doing all the speaking. The map canvas is the only thing in the room with color, depth, and motion. This is not a dashboard that happens to contain a picture; it is a specimen table built to frame one specimen.

The chrome's entire palette is derived from the specimen itself: the accent *is* the map's ocean color (#20658c), pressed into service for the primary action and focus rings. Neutrals are deep sediment grays that recede. The one shadow in the system lives under the canvas — the lamp above the light table — and nothing else is ever lifted.

**Key Characteristics:**

- Dark tonal chrome; color belongs to the map, not the interface
- Exactly one elevated object: the canvas specimen
- Instrument-grade controls: touch-height (2.5rem), native widgets, tabular readouts
- Motion is rationed — 150ms state transitions in the chrome; all real motion belongs to the staged reveal
- Pixel-crisp presentation: nearest-neighbor upscale, no smoothing anywhere

## Colors

The palette is a deep-sea sediment scheme with one living accent lifted from the generated map itself.

### Primary

- **Surveyor's Ocean** (#20658c): the map's own ocean color, used for the Generate button fill (white text ≈ 6.4:1) and slider accent. It appears nowhere else — rarity is what makes the primary action obvious.
- **Surveyor's Ocean, Bright** (#3d8ab8): hover state and focus rings (≈ 4.7:1 on background, ≥ 3:1 non-text on panels; WCAG-verified). The only lighter twin the accent is allowed.

### Neutral

- **Night Sediment** (#111827): page background and inset surfaces (inputs, quiet buttons) — the two roles intentionally share a value so insets read as cut-outs, not new layers.
- **Raised Sediment** (#1f2937): control panel surface.
- **Sediment Edge** (#374151): 1px borders and dividers; the system's only structural line weight.
- **Driftwood** (#e5e7eb): primary text.
- **Driftwood, Muted** (#9ca3af): labels, tagline, stage line, quiet-button text.
- **Foam** (#ffffff): text on Surveyor's Ocean fills only (the primary action).

### Tertiary (state)

- **Coral Warn** (#fca5a5) on **Undertow** (#7f1d1d) with **Undertow Edge** (#b91c1c): the error/retry surface — light coral on deep red (≈ 5.3:1), never pure red on dark.

### Named Rules

**The Loud Specimen Rule.** The chrome carries no saturated color except Surveyor's Ocean, and only on the primary action, focus, and slider fill. Every other hue in the interface comes from the generated map itself.

**The Cut-Out Rule.** Inset surfaces (inputs, quiet buttons) reuse the page background value (#111827) rather than introducing a new tone — they are holes in the panel, not objects on it.

## Typography

**Display/Body Font:** system-ui (with -apple-system, 'Segoe UI', Roboto, sans-serif fallbacks)
**Label/Mono Font:** same family; the system is single-voice by design — no web fonts, no pairing.

**Character:** Utilitarian and instrument-like. Hierarchy comes from size, weight (650 for the title, 600 for the primary action, 400 everywhere else) and muting — never from a second typeface. Numbers are always tabular where they change (readouts, seed).

### Hierarchy

- **Title** (650, 1.25rem, lh 1.4, +0.01em tracking): the h1 — once, centered in the header.
- **Body** (400, 0.9375rem, lh 1.4): seed input, primary button text.
- **Body, secondary** (400, 0.875rem, lh 1.4): quiet buttons, stage label, error copy.
- **Label** (400, 0.8125rem): slider labels, tagline, readouts.
- **Glyph** (400, 1.125rem, lh 1): the dice button's single emoji glyph.
- **Readout** (400, 0.8125rem, tabular-nums): live slider values, right-aligned.

### Named Rules

**The Single Voice Rule.** One family, five sizes. Never introduce a display font, a monospace accent, or letter-spaced uppercase labels.

## Layout

A single centered column (max-width 1080px) holding one flexible main row: the specimen stage (width `min(90vmin, 640px)` — canvas, probe overlay, and the caption block stack inside it, aspect 1/1) beside a fixed 280px control column. The row never wraps; between ~641–975px the stage shrinks so tune-and-see stays side by side, and below 640px the layout stacks — stage first (100% up to 512px), controls below — remaining fully usable at 375px. Panel rhythm is three tiers: rows gap 0.5rem internally, the stack gaps 0.875rem, and cluster starts (presets, outputs) breathe 1.25rem — tune → act (presets + Generate) → export. Under the specimen, the stage label and the probe reading form one tight caption group (each reserving 1.5em so appearing/disappearing text never shifts the layout). Touch targets are uniformly ≥ 2.5rem tall.

## Elevation & Depth

Tonal layering by default: depth is conveyed by background steps (night → raised) and 1px sediment edges, never by shadows. Exactly one shadow exists in the entire system.

### Shadow Vocabulary

- **The Lamp** (`box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5)`): under the map canvas only. Nothing else may cast a shadow.

### Named Rules

**The Single Shadow Rule.** The specimen is lifted; the instruments never are. If a future surface feels like it needs elevation, it is either the canvas or it is wrong.

## Shapes

A three-step radius scale keyed to prominence: 6px for small controls (seed input, in-error buttons), 8px for standard buttons and the error region, 10px for the panel and the canvas itself. Bigger containers round more; nothing is pill-shaped; borders are always 1px Sediment Edge. The canvas pairs its 10px radius with `image-rendering: pixelated` (crisp-edges fallback) — the pixel grid is a deliberate material, never smoothed.

## Components

### Buttons

- **Shape:** gently rounded (8px), touch-height (2.5rem), `0.5rem 0.75rem` padding.
- **Primary (Generate):** Surveyor's Ocean fill, white text, weight 600, grows to fill its row. Hover brightens to the ocean's lighter twin. Exactly one per screen.
- **Skip:** Generate's compact quiet companion — content-width, Driftwood Muted text (0.875rem); disabled whenever nothing is playing. Never equal-flex with the primary action.
- **Quiet (presets, Export PNG, Copy link):** Night Sediment cut-out fill, Driftwood Muted text (0.875rem). Hover brightens the *border* to ocean-bright — quiet buttons never change fill. Labels name their outcome: Export PNG downloads a PNG of the map; Copy link copies the shareable URL to the clipboard (flashing to "Link copied" on success, with a labeled manual-copy fallback when every automatic path fails).
- **Icon (🎲):** square (2.5rem × 2.5rem), 1.125rem glyph, same quiet treatment. Rolling tumbles the die once — a single 380ms full turn with a small hop, the panel's only authored glyph moment (the global reduced-motion guard disables it).
- **Focus:** 3px ocean-bright outline, 2px offset, on every interactive element.
- **Disabled:** 0.45 opacity, not-allowed cursor — no other change.

### Inputs / Fields

- **Seed input:** cut-out fill (Night Sediment), 1px Sediment Edge, 6px radius, 2.5rem height, tabular-friendly 0.9375rem text, `autocomplete="off"`. The seed domain is integers in [0, 999999999] — one rule across panel, controller, and URL wire, so a seed can never change value between commit, share, and restore ('1e6' commits a million; '3.7', negatives, and over-max are rejected). Invalid commits revert the display and reveal the field hint — 0.8125rem Coral Warn on the panel, aria-live polite — naming the domain; a valid commit or a 🎲 roll clears it. When the error state disables the panel, focus moves to Try again rather than dropping to the page.
- **Manual-copy fallback input:** the cut-out treatment at 0.875rem under a Driftwood Muted label; revealed only when every automatic copy path has failed.
- **Range sliders:** native widgets, `accent-color: surveyors-ocean`, full row width, 2.5rem touch height. Native = keyboard-operable for free; do not rebuild them.

### Chips (preset row)

Three quiet buttons in a content-based row (`flex: 1 1 auto`, Label-size 0.8125rem text, 0.25rem side padding) — Archipelago / Continent / Highlands, sized so the longest name holds one line inside the 280px panel. Active/pressed state is the quiet-button hover border (ocean-bright), persistent, and rendered from ONE source: the app's sticky preset id — the same value the share URL carries — never re-derived from slider positions. Chip, link, and truth cannot disagree: a moisture tweak keeps the chip pressed with the URL; an elevation input clears both together; returning to a preset's exact sliders does not re-press anything (coincidence is not selection).

### Cards / Containers

- **Control panel:** Raised Sediment, 1px Sediment Edge, 10px radius, 1rem padding, 0.875rem internal stack with 1.25rem cluster starts (presets, outputs). The only card in the product.

### Signature: The Specimen (map canvas)

- 512×512 internal, displayed up to 640px, aspect-locked 1/1, 10px radius, The Lamp shadow, `image-rendering: pixelated`. Clicking it skips the staged animation (cursor: pointer). Its 12-color biome palette is *product data*, not chrome — the chrome borrows from it (the ocean accent), never the reverse.

### Signature: The Surveyor's Probe (crosshair + reading)

The map is an instrument, not a picture. Hovering the canvas (or focusing it and moving with the arrow keys — ±1 field pixel, Shift ±8) lowers a crosshair and reports a live reading on a reserved line under the specimen: `312, 208 · elev 0.62 · moist 0.31 · Taiga`.

- **Crosshair:** a DOM overlay (`#probe-overlay`, `aria-hidden`, `pointer-events: none`) — Foam hairlines on a dark halo, so they read on Snow as well as Deep Ocean. It never paints canvas pixels and never triggers a readback; the canvas itself shows `cursor: crosshair` and claims touch drags for surveying (`touch-action: none`).
- **Reading:** Driftwood Muted, 0.8125rem, tabular-nums, centered, reserved height (the stage-label discipline). The biome name is the classifier's *live* answer — `classify` under the controller's current moisture biases — so moving the moisture slider re-names the pixel under the crosshair.
- **Parking (the coupling):** leaving the canvas or blurring it does *not* retract the instrument — the crosshair and reading park at the last station while the surveyor turns a dial, and every controller event re-reads that station through the live getters. The moisture slider re-naming the parked pixel is the product's principle #1 made real. Refreshes are visible-only: the announcer speaks when the surveyor moves the probe, never when the gauge re-reads.
- **Keyboard:** the canvas is focusable (standard focus ring) and arrow-probing announces through a visually-hidden polite live region (`#probe-announce`); pointer moves never announce (no chatter).
- Coordinates are field pixels at the renderer's *current* resolution (512² finals, 256² drag previews) — the reading always describes what is on screen. Before the first fields land, the instrument stays dark.

### Status: the caption block (stage label + probe reading)

Map status lives under the map, in the `#stage-status` caption block inside the stage — never in the control panel. The panel *drives* the stage label (reserved-height 1.5em, 0.8125rem, Driftwood Muted, centered) with full text written in JS — no CSS prefix — while the reveal runs ("Stage: Elevation → Moisture → Biomes"), settling to "Map ready · seed N" when done: the determinism promise stated in the caption, since N is exactly what a share link reproduces. It is announced to assistive tech via aria-live (the visual line never blinks or jumps). It sits directly above the probe reading as one tight caption group.

## Do's and Don'ts

### Do:

- **Do** keep exactly one primary action per screen, filled with Surveyor's Ocean.
- **Do** give quiet buttons a border-color change on hover — never a fill change.
- **Do** use tabular-nums for every value that updates live (readouts, seed).
- **Do** keep all touch targets ≥ 2.5rem and outlines at 3px / 2px offset when focused.
- **Do** let the canvas own all motion and color; new chrome motion stays at ~150ms ease and stops there.

### Don't:

- **Don't** add shadows anywhere except under the map canvas (The Single Shadow Rule).
- **Don't** introduce a second accent hue or any saturated chrome color beyond Surveyor's Ocean and its bright twin (The Loud Specimen Rule).
- **Don't** add fonts, weights outside {400, 600, 650}, or uppercase letter-spaced labels.
- **Don't** smooth the canvas — pixelated rendering is the material, not a bug.
- **Don't** replace native sliders/inputs with custom widgets; nativeness is the accessibility strategy.
