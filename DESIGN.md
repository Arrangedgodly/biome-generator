---
name: Procedural Biome Generator
description: A ground station receiving procedural terrain — false-color bands acquired into one luminous map under instrument chrome.
colors:
  bg: "#0d1b2e"
  panel: "#122238"
  panel-edge: "#32536f"
  graticule: "#3a6a94"
  panel-inset: "#081019"
  text: "#eaf2f7"
  text-muted: "#93a9be"
  foam: "#ffffff"
  accent: "#ffb547"
  accent-bright: "#ffc97d"
  accent-ink: "#241300"
  danger-text: "#ffb4a6"
  danger-bg: "#461722"
  danger-edge: "#8c3242"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "clamp(1.4rem, 2.6vw, 1.9rem)"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
    fontVariation: "wdth 112"
  stamp:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.04em"
    fontVariation: "wdth 110"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "'Martian Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "0.06em"
  micro-label:
    fontFamily: "'Martian Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace"
    fontSize: "0.625rem"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.09em"
  readout:
    fontFamily: "'Martian Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.45
  seed-field:
    fontFamily: "'Martian Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  xs: "1px"
  sm: "2px"
  md: "3px"
spacing:
  xs: "0.6rem"
  sm: "1rem"
  md: "1.5rem"
  lg: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.stamp}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.accent-bright}"
    textColor: "{colors.accent-ink}"
  button-quiet:
    backgroundColor: "{colors.panel-inset}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.75rem"
    height: "2.5rem"
  button-preset-active:
    backgroundColor: "rgba(255, 181, 71, 0.08)"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    height: "2.5rem"
  input-seed:
    backgroundColor: "{colors.panel-inset}"
    textColor: "{colors.text}"
    typography: "{typography.seed-field}"
    rounded: "{rounded.sm}"
    height: "2.5rem"
    padding: "0 0.625rem"
---

# Design System: Procedural Biome Generator

## Overview

**Creative North Star: "The False-Color Survey"**

The app is a ground station receiving procedural terrain. The map is read as a false-color composite acquired in bands — the only luminous, saturated object on the screen — and everything around it is telemetry: ruler ticks, registration marks, mono readouts, labeled modules. The lineage is earth-observation practice (Landsat/Sentinel band composites, mission consoles), and the world exists to refuse the default it was built against: the dark dashboard with a slider sidebar. There is no sidebar; there is one instrument, and the visitor reads it top-to-bottom the way a capture is made — Capture, Field bands, Survey presets, Acquire, Data out.

Depth is structural, not luminous: flat night-navy panels, 1px steel hairlines, and one inset well per module. Exactly one signal color exists — capture amber — and it is rationed to what is live: the readouts, the signal LED, the slider thumbs, the latched preset, focus rings and hover edges, and the Acquire stamp. Structure is never amber; the graticule steel of the rulers, chip separators, and the legend toggle carries the measuring apparatus instead.

Motion belongs to the map. The staged band reveal is the product; chrome settles in 150ms and nothing else moves except the busy LED pulse and a one-shot dice tumble — all disabled under a global `prefers-reduced-motion` guard. The composite stays pixel-crisp: 512² rendered nearest-neighbor, never smoothed.

**Key Characteristics:**

- One luminous false-color composite; chrome is instrumentation, never decoration
- Night-navy ground, ice text, steel hairlines, one capture-amber signal spent only on live things
- Archivo speaks (display/UI); Martian Mono measures (every label, readout, and coordinate)
- Flat panels + 1px hairlines carry all depth — zero shadows in the chrome
- Instrument apparatus: coordinate rulers 0–512, registration brackets, inset wells, gain-ruler sliders
- Motion is rationed: the staged reveal owns it; chrome transitions at 150ms; reduced-motion kills all

## Colors

A night-navy station of one hue family and one amber signal: steel structure, ice text, and a single live color.

### Primary

- **Capture Amber** (#ffb547): the one signal. Live telemetry text (slider readouts, ≈ 9.8:1 on panel), the 8×8 signal LED, slider thumbs, the latched preset's edge and text, and the Acquire stamp's fill (ink text ≈ 10.2:1). Text selection and the caret spend it too — they are live edits.
- **Capture Amber, Bright** (#ffc97d): the signal's high-power state — focus rings (3px outline, ≈ 12.3:1 on bg) and hover edges on quiet buttons and the source link. The only lighter twin amber is allowed.

### Tertiary (state)

- **Readable Coral** (#ffb4a6) on **Deep Maroon** (#461722) with **Maroon Edge** (#8c3242): the error/retry module and the field-level seed hint (≈ 8.8:1). Light coral on deep maroon — never pure red on dark.

### Neutral

- **Night Navy** (#0d1b2e): the station's ground — page background.
- **Station Panel** (#122238): raised chrome surfaces — the raster plate frame and the telemetry rack.
- **Steel Edge** (#32536f): 1px borders and hairlines on every framed surface; the minor ruler ticks; slider tracks.
- **Graticule Steel** (#3a6a94): the measuring apparatus — major ruler ticks, truth-chip `/` separators, the legend `+`/`–` toggle. Structural marker color; never a signal.
- **Inset Well** (#081019): the cut-out floor of inputs, quiet buttons, and the canvas bed — holes in the panel, not objects on it.
- **Ice** (#eaf2f7): primary text.
- **Ice, Muted** (#93a9be): labels, tagline, ruler numerals, chip text, quiet-button text, probe reading.
- **Foam** (#ffffff): the probe crosshair's 1px lines and reticle only — white that reads on Snow biomes as well as Deep Ocean (with the halo below).

### Named Rules

**The Amber Economy Rule.** Amber marks what is live and nothing else: readouts, the LED, slider thumbs, the latched preset, focus rings/hover edges, the Acquire stamp, selection/caret. One amber fill per screen (the stamp). Structure, dividers, and markers are steel; if everything is amber, nothing is being signaled.

**The Chrome Recedes Rule.** The map is the only saturated object on screen. Chrome carries no hue beyond navy, steel, ice, amber-as-signal, and the danger family. The 12-color biome palette is product data living inside the composite — chrome never borrows a biome color, and never lends chrome colors to the map.

*(Constraint: the `:root` tokens `--bg`, `--panel`, `--accent-bright`, `--text`, `--danger-text`, `--danger-bg` are parsed as `#rrggbb` by `src/ui/layout.test.ts` to enforce WCAG contrast — keep those names and that hex format in `src/style.css`.)*

## Typography

**Display/UI Font:** Archivo (with system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif fallbacks) — loaded via CSS `@import` with variable axes `wdth 75..125, wght 400..800`
**Body Font:** Archivo (same stack)
**Label/Mono Font:** Martian Mono (with ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas fallbacks) — axes `wght 400..600`

**Character:** An aerospace grotesque paired with a technical mono. Archivo is compressed at display sizes (`font-stretch: 112%` on the h1, `110%` on the Acquire stamp) so even the title reads like stenciled hardware; Martian Mono is the station's measurement voice — every label, numeral, coordinate, and control caption.

### Hierarchy

- **Display** (800, clamp(1.4rem, 2.6vw, 1.9rem), lh 1.15, −0.02em, wdth 112%): the h1 in the mission strip — once.
- **Stamp** (700, 0.9375rem, +0.04em, uppercase, wdth 110%): the Acquire button — the only place Archivo goes loud.
- **Body** (400, 0.9375rem, lh 1.45): sentence prose — tagline, error copy, this is the base body size.
- **Label** (400, 0.6875rem, +0.06em, uppercase mono): control-row labels, the Skip button, source link, legend names, the seed hint, share-fallback label.
- **Micro-label** (500, 0.625rem, +0.09em, uppercase mono): module nomenclature — rack section labels, truth chips, the legend summary; quiet preset/export/share buttons track at 0.625rem/+0.06em.
- **Readout** (400, 0.75rem, mono): the amber slider readouts (right-aligned, 3em column), the pass-line, the probe reading, the fallback input.
- **Seed field** (400, 0.875rem, mono): typed telemetry — the seed input, the largest mono on screen.

### Named Rules

**The Two Voices Rule.** Archivo speaks; Martian Mono measures. Anything that is a measurement, coordinate, label, or machine caption is Martian Mono. Anything that is a human sentence is Archivo. Never set a numeral that changes in Archivo, never set a sentence in mono.

## Layout

A 1220px shell centered on night navy. The **mission strip** spans the top (padding 1.1rem 1.5rem 0.9rem, closed by a 1px steel hairline): title + tagline left; right-aligned truth chips (one telemetry line, `/` separators in graticule steel) with the quiet "View the source on GitHub" exit ramp beneath. Below, the core **pairing**: the raster plate (flexible, `width: min(90vmin, 720px)`, max 720px) beside the **telemetry rack** (fixed 340px), one row, `flex-wrap: nowrap`, 2rem gap — the tune-and-see coupling never wraps; in the mid range the plate shrinks (`min-width: 0`) instead. Below 640px the layout stacks (plate first, rack second, both 100% up to 680px) and stays usable at 375px; control labels narrow from a 5.75em column to 4.75em.

The rack reads top-to-bottom as the acquisition workflow, divided by module labels: **Capture** (seed + dice) → **Field bands** (elevation, moisture) → **Survey presets** (3-up) → **Acquire** (Generate + Skip) → **Data out** (Export PNG + Copy link). Rows are `0 1rem 0.75rem` with 0.6rem internal gaps; module labels get more air above (0.9rem) than below (0.55rem). Under the plate, the caption group stacks: pass-line (with LED), probe reading, legend — each on reserved lines. Every touch target is ≥ 2.5rem (the Acquire stamp is 2.75rem; the legend summary 2rem).

### Named Rules

**The Reserved Line Rule.** The pass-line and the probe reading each reserve their height (`min-height: 1.5em`) before anything is written to them. State text appears and disappears; the plate never shifts.

**The Pairing Rule.** The plate and the rack are one instrument: never separate them into pages, never let the row wrap, never stack above 640px. Tuning without seeing is a dashboard; that is the refused world.

## Elevation & Depth

Flat by doctrine. Depth is tonal — night navy ground → station panel → inset well — plus 1px steel hairlines. No panel is ever lifted, glazed, or shadowed; there is no `box-shadow` in the chrome. The only shadow in the system is functional, not structural: the probe crosshair's legibility halo, which exists so 1px foam lines read over bright biomes.

### Shadow Vocabulary

- **Probe Halo** (`box-shadow: 0 0 2px 1px rgba(8, 16, 25, 0.75)`): on the probe's crosshair lines and reticle only — a darkening scrim under white hairlines on the map. Never used on chrome, never used for elevation.

### Named Rules

**The Flat Station Rule.** Surfaces are flat panels with 1px hairlines. If a future surface seems to need a shadow, it needs a hairline or a tone step instead. The probe halo is not a precedent; it is part of the instrument that reads the map.

## Shapes

Radius is keyed to role, and the scale is nearly square: 3px (`--radius`) on the two framed surfaces (the plate, the rack panel); 2px on inset controls (inputs, buttons, swatches, the error module); 1px on slider thumbs. Nothing rounds past 3px; nothing is pill or circular. Signals are square: the 8×8 LED, the 10×22 amber thumb block, the 12×12 legend swatches. Borders are always 1px. The plate's apparatus is geometric — a 5px-tall ruler strip per axis with major ticks every 1/8 in graticule steel and minor ticks every 1/32 in edge steel, numeric labels at the quarters (0, 128, 256, 384, 512), and 11×11 square registration brackets (2px stroke) pinned at the frame's corners. The canvas bed is the inset well; the composite renders `image-rendering: crisp-edges` then `pixelated` — the pixel grid is the material.

## Components

### Buttons

- **Shape:** near-square (2px radius), cut-out inset-well fill, 1px steel border, touch height 2.5rem, `0.5rem 0.75rem` padding.
- **Primary (the Acquire stamp):** capture-amber fill, amber-ink text, weight 700, wdth 110%, +0.04em uppercase, grows to fill its row (`flex: 1 1 auto`), 2.75rem tall. Hover brightens fill and border to amber-bright. Exactly one per screen.
- **Hover (quiet buttons):** border-color shifts to amber-bright — never a fill change. 150ms ease.
- **Skip:** the stamp's quiet companion — content-width, Label-size mono uppercase in ice text, disabled whenever nothing is playing.
- **Quiet (presets, Export PNG, Copy link):** inset-well fill, muted mono uppercase 0.625rem. Copy link flashes to "Link copied" for 1.5s (announced aria-live); when every automatic copy path fails, a labeled read-only manual-copy input appears below the row.
- **Icon (dice):** square 2.5rem, an authored five-pip SVG die (18px, currentColor stroke — no emoji). Rolling triggers a one-shot tumble (380ms, one full turn with a hop); the global reduced-motion guard disables it.
- **Focus:** 3px amber-bright outline, 2px offset, on every interactive element (including the canvas and the legend summary). Disabled: 0.45 opacity, not-allowed cursor — no other change.

### Inputs / Fields

- **Seed field:** cut-out well (inset background, 1px steel border, 2px radius, 2.5rem), mono 0.875rem ice text. Domain is integers in [0, 999,999,999]; an invalid commit reverts the display and reveals the field hint — Label-size mono coral, indented to align under the input column, aria-live polite — naming the rule.
- **Gain-ruler sliders:** native range inputs dressed as instruments — appearance stripped, 2px steel track (WebKit carries minor tick marks via a repeating gradient), 10×22 amber block thumb with a 1px amber-ink border and 1px radius. Native widgets: keyboard-operable for free; do not rebuild them. Readouts are `aria-describedby`-paired amber mono at the row's 3em right column.

### Chips

- **Truth chips (mission strip):** one micro-label telemetry line — muted mono uppercase, `/` separators in graticule steel. Not interactive; structure, not signal.
- **Preset chips:** three quiet cut-out buttons in a 3-up row (the longest name holds one line). The latched mode (`aria-pressed="true"`) spends three signals the quiet chips don't: amber border, amber text, and a faint amber tint (rgba(255, 181, 71, 0.08)) over the shared cut-out fill. Latch state renders from the controller's sticky preset id — the same value the share URL carries — never re-derived from slider positions.

### Cards / Containers

- **The telemetry rack:** station panel, 1px steel border, 3px radius, 0.85rem top padding, divided into labeled modules (see Layout).
- **The raster plate:** the frame around the composite — station panel, 1px steel border, 3px radius; rulers top (labels at 7px) and left (a 24px label gutter), tick strips, corner registration brackets; padding 30px 10px 10px 36px.

### Navigation

- **The source link:** the portfolio exit ramp under the truth chips — Label-size mono, ice-muted, underline in steel edge (3px offset), brightening to amber-bright on hover. The only navigation on screen; quieter than everything around it except at hover.

### Signature: The Raster Plate

The plate is a survey instrument, not a picture frame. A 512² canvas, aspect-locked 1/1, displayed up to 720px, sitting in the inset well with nearest-neighbor rendering; coordinate rulers (0–512, majors every 1/8 in graticule steel, minors every 1/32 in edge steel) and corner registration brackets are `aria-hidden` apparatus describing the raster it carries. The cursor is a crosshair — the target lock lives here; while the reveal plays, it switches to `pointer` (click skips) via a `.revealing` class that exists exactly when skipping is true. `touch-action: none`: touch drags survey the composite, not the page.

### Signature: The Surveyor's Probe

A DOM overlay (`pointer-events: none`, `aria-hidden`) — never a canvas paint. Foam hairlines (1px, haloed) full-height and full-width plus a 7×7 reticle square centered on the locked field pixel. Hover, or focus + arrow keys (±1 field pixel, Shift ±8), reports a live reading on the reserved line under the plate: `312, 208 · elev 0.62 · moist 0.31 · Taiga` — computed from the renderer's live fields and the classifier's current moisture biases, so turning the moisture dial re-names the parked pixel. Leaving or blurring parks the instrument at the last station; it does not retract. Before the first probe, the reserved line teaches: "Hover the map to survey a pixel — arrow keys work too." Keyboard moves announce through a visually-hidden polite region; pointer moves never announce.

### Signature: The Pass-Line + Signal LED

Map status lives under the map: a mono 0.75rem line prefixed by an 8×8 amber LED square (the gap is 0.55rem; the probe reading indents to align with the LED's text). While bands acquire (`#stage:has(#map-canvas[aria-busy='true'])`) the LED pulses (1.1s ease-in-out, 50% keyframe at 0.3 opacity) — an enhancement that degrades to a steady LED where `:has` is unsupported. The line carries "Surveying…" on generate-class arrivals, stage names while the reveal runs, and settles to "Map ready · seed N" — the determinism promise stated in the caption, since N is exactly what a share link reproduces.

### The Biome Legend

A native `<details>` closed to one quiet line ("+ Biome legend", the glyph in graticule steel) until asked; swatches (12px squares, 2px radius, 1px steel edge so pale biomes read on the panel floor) are populated from the same `BIOMES` data the renderer classifies with — the key can never drift from the pixels it explains. No meaning rides on color alone: every swatch is paired with its name.

## Do's and Don'ts

### Do:

- **Do** spend amber only on what is live, and keep exactly one amber fill per screen — the Acquire stamp (The Amber Economy Rule).
- **Do** render every marker, divider, and ruler tick in graticule steel or steel edge; structure is never amber.
- **Do** set every label, numeral, and coordinate in Martian Mono; sentences in Archivo (The Two Voices Rule).
- **Do** keep touch targets ≥ 2.5rem and focus at 3px amber-bright / 2px offset on every interactive element.
- **Do** reserve caption line heights (1.5em) so state text never shifts the plate (The Reserved Line Rule).
- **Do** keep the canvas nearest-neighbor (`crisp-edges` declared before `pixelated`) — pixel-crisp is the material.
- **Do** let chrome settle at 150ms ease and stop there; all meaningful motion belongs to the staged reveal, the busy LED pulse, and the one-shot dice tumble, all under the reduced-motion guard.

### Don't:

- **Don't** put a shadow on any chrome surface — depth is tone steps and 1px hairlines (The Flat Station Rule); the probe halo is functional legibility on the map, not elevation.
- **Don't** introduce a second accent hue or any saturated chrome color; the danger family is the only other chroma and it is reserved for failure.
- **Don't** fill quiet buttons on hover — hover spends the amber edge only.
- **Don't** round anything past 3px, pill a control, or circle a signal; signals are square.
- **Don't** replace native sliders, inputs, or the details/summary with custom widgets; nativeness is the accessibility strategy.
- **Don't** rename or reformat the `:root` tokens `--bg`, `--panel`, `--accent-bright`, `--text`, `--danger-text`, `--danger-bg` — they are test-enforced (`src/ui/layout.test.ts`) as `#rrggbb`.
- **Don't** let the map's palette leak into the chrome or the chrome's into the map (The Chrome Recedes Rule).
