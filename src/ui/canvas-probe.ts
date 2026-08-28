/**
 * The Surveyor's Probe (delight pass) — the map becomes an instrument.
 *
 * Hovering the canvas (or focusing it and moving with the arrow keys) lowers
 * a crosshair onto the specimen and reports a live reading under it:
 *
 *     312, 208 · elev 0.62 · moist 0.31 · Taiga
 *
 * The reading is computed from the SAME data the renderer holds — the cached
 * fields plus `classify` under the controller's live moisture biases — so the
 * probe's biome name is the classifier's answer, not a caption. Moving the
 * moisture slider changes what the probe calls the pixel under the crosshair;
 * that is the point (product principle 1: reveal, don't just render).
 *
 * Architecture rules it obeys:
 * - The canvas pixels are never touched — the crosshair is a DOM overlay
 *   (`#probe-overlay`, `aria-hidden`, `pointer-events: none`); D2's
 *   no-readback rule stays intact (array reads via `renderer.sample`).
 * - All coordinates flow through the renderer's CURRENT field resolution
 *   (512² finals, 256² elevation-drag previews), so the reading always
 *   describes what is on screen.
 * - Pointer moves update the visible readout only (no aria-live chatter);
 *   KEYBOARD moves additionally announce through a visually-hidden polite
 *   live region (`#probe-announce`). Arrow keys step 1 field pixel, Shift
 *   steps 8; the canvas is focusable (tabindex=0 in index.html) and gets the
 *   standard focus ring (canvas:focus-visible).
 * - Leaving the canvas (or blurring it) PARKS the instrument at the last
 *   station instead of retracting it: the surveyor keeps one hand on the
 *   moisture dial while reading the gauge. `refresh()` re-reports that
 *   station through the live getters — app.ts wires it to every controller
 *   event — so turning the dial re-names the parked pixel (principle 1 made
 *   real, critique P1-1). Refreshes are visible-only: the announcer speaks
 *   when the surveyor moves the probe, not when the gauge re-reads.
 * - Everything is injected (`CanvasProbeDeps`), so the whole probe is
 *   testable against fakes in happy-dom (`canvas-probe.test.ts`) — same
 *   pattern as the control panel.
 */

import { BIOMES, classify } from '../generation/index.ts';
import type { ClassifyBiases } from '../generation/index.ts';

/** Field sample the renderer supplies (undefined before the first fields). */
export interface FieldSample {
  elevation: number;
  moisture: number;
}

/** Injectable world the probe reads (all getters stay live across rebuilds). */
export interface CanvasProbeDeps {
  /** Current field sample at integer field coordinates (clamped by renderer). */
  sample(fx: number, fy: number): FieldSample | undefined;
  /** Current field resolution (0 before the first fields). */
  fieldResolution(): number;
  /** Live classification biases (moisture slider). */
  biases(): ClassifyBiases;
  /** Canvas CSS box — injectable for tests (happy-dom rects are all zero). */
  rect?(): DOMRect;
}

export interface CanvasProbeHandle {
  /**
   * Re-report the parked station through the live getters — new fields, new
   * biases. Visible-only: refreshes never announce. No station, no effect.
   */
  refresh(): void;
  /** Remove every listener the probe registered (DOM stays). */
  destroy(): void;
}

/** Field-pixel step for Shift+Arrow probing (one chunky pixel-art cell ×8). */
const KEYBOARD_STEP_FAST = 8;

function clampField(v: number, res: number): number {
  if (res <= 0) return 0;
  return Math.min(Math.max(v, 0), res - 1);
}

function twoDecimals(v: number): string {
  return v.toFixed(2);
}

/** Non-null document query — the skeleton is part of the layout contract. */
function requireSelector<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (el === null) {
    throw new Error(`attachCanvasProbe: ${selector} not found (see index.html)`);
  }
  return el;
}

/**
 * Wires the probe onto the static `#stage` skeleton (index.html): the canvas,
 * the `#probe-overlay` crosshair (`aria-hidden` decoration), the visible
 * `#probe-readout` line, and the `#probe-announce` live region. Throws on a
 * missing element — the skeleton is part of the contract (layout.test.ts).
 */
export function attachCanvasProbe(canvas: HTMLCanvasElement, deps: CanvasProbeDeps): CanvasProbeHandle {
  const overlay = requireSelector<HTMLElement>('#probe-overlay');
  const readout = requireSelector<HTMLElement>('#probe-readout');
  const announce = requireSelector<HTMLElement>('#probe-announce');
  const lineV = requireSelector<HTMLElement>('#probe-overlay .probe-v');
  const lineH = requireSelector<HTMLElement>('#probe-overlay .probe-h');
  const dot = requireSelector<HTMLElement>('#probe-overlay .probe-dot');

  const getRect = deps.rect ?? (() => canvas.getBoundingClientRect());

  const disposers: Array<() => void> = [];
  function listen(target: HTMLElement, type: string, fn: (event: Event) => void): void {
    target.addEventListener(type, fn);
    disposers.push(() => target.removeEventListener(type, fn));
  }

  // Keyboard mode is tracked only to gate the arrow keys (focus owns them).
  let keyboardActive = false;
  let keyX = 0;
  let keyY = 0;
  // The parked station: the last successfully reported field pixel. It
  // survives pointerleave/blur (the instrument parks, not retracts) and is
  // what `refresh()` re-reads when the world changes under it.
  let lastProbe: { fx: number; fy: number } | null = null;

  /**
   * Field-pixel center → CSS pixels inside the overlay. Scaled by the CANVAS
   * box (`getRect`), never the overlay's own clientWidth/clientHeight: the
   * overlay is hidden while parked (display:none → clientWidth 0), and the
   * first reading after idle must land on the probed pixel, not at (0,0).
   * The overlay exactly covers the canvas, so both boxes share this geometry.
   */
  function cssX(fx: number): number {
    const res = Math.max(deps.fieldResolution(), 1);
    return ((fx + 0.5) / res) * getRect().width;
  }

  function cssY(fy: number): number {
    const res = Math.max(deps.fieldResolution(), 1);
    return ((fy + 0.5) / res) * getRect().height;
  }

  function positionCrosshair(fx: number, fy: number): void {
    const x = cssX(fx);
    const y = cssY(fy);
    lineV.style.left = `${x}px`;
    lineH.style.top = `${y}px`;
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
  }

  function setOverlay(visible: boolean): void {
    overlay.hidden = !visible;
  }

  /** One reading → visible line (+ announcer when keyboard-driven). */
  function report(fx: number, fy: number, viaKeyboard: boolean): void {
    const res = deps.fieldResolution();
    const s = res > 0 ? deps.sample(fx, fy) : undefined;
    if (s === undefined) {
      // No fields yet (boot race, dead stack) — the instrument stays dark.
      lastProbe = null;
      readout.textContent = '';
      if (viaKeyboard) announce.textContent = '';
      setOverlay(false);
      return;
    }
    lastProbe = { fx, fy };
    const biome = BIOMES[classify(s.elevation, s.moisture, deps.biases())];
    readout.textContent =
      `${fx}, ${fy} · elev ${twoDecimals(s.elevation)} · moist ${twoDecimals(s.moisture)} · ${biome.name}`;
    // Show before positioning: the crosshair must never sit at a pre-layout
    // position in the frame it appears in.
    setOverlay(true);
    positionCrosshair(fx, fy);
    if (viaKeyboard) {
      // Name-first sentence for screen readers; coordinates in field pixels.
      announce.textContent =
        `${biome.name} at ${fx}, ${fy} — elevation ${twoDecimals(s.elevation)}, moisture ${twoDecimals(s.moisture)}`;
    }
  }

  // ---- pointer mode ---------------------------------------------------------

  function pointerField(event: Event): { fx: number; fy: number } | undefined {
    const res = deps.fieldResolution();
    if (res <= 0) return undefined;
    const rect = getRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    const e = event as { clientX?: number; clientY?: number };
    if (typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return undefined;
    const fx = clampField(Math.floor(((e.clientX - rect.left) / rect.width) * res), res);
    const fy = clampField(Math.floor(((e.clientY - rect.top) / rect.height) * res), res);
    return { fx, fy };
  }

  listen(canvas, 'pointermove', (event) => {
    const hit = pointerField(event);
    if (hit === undefined) return;
    report(hit.fx, hit.fy, false);
  });

  // No pointerleave handler: leaving the canvas PARKS the crosshair and
  // reading at the last station. Retracting here is what made the moisture
  // coupling unreachable (critique P1-1) — the dial and the gauge must be
  // usable at once, and the parked crosshair shows exactly what is read.

  // ---- keyboard mode ----------------------------------------------------------

  function focusProbe(): void {
    const res = deps.fieldResolution();
    if (res > 0) {
      // Start at the center of the specimen — the natural surveyor's stance.
      keyX = Math.floor(res / 2);
      keyY = Math.floor(res / 2);
    }
  }

  listen(canvas, 'focus', () => {
    keyboardActive = true;
    focusProbe();
    report(keyX, keyY, true);
  });

  listen(canvas, 'blur', () => {
    // Blur PARKS at the last station too: moving focus to the sliders is
    // exactly when the reading must stay visible (the coupling path). Arrow
    // keys are gated off by keyboardActive until the canvas regains focus.
    keyboardActive = false;
  });

  listen(canvas, 'keydown', (event) => {
    if (!keyboardActive) return;
    const step = (event as KeyboardEvent).shiftKey ? KEYBOARD_STEP_FAST : 1;
    let dx = 0;
    let dy = 0;
    switch ((event as KeyboardEvent).key) {
      case 'ArrowLeft':
        dx = -step;
        break;
      case 'ArrowRight':
        dx = step;
        break;
      case 'ArrowUp':
        dy = -step;
        break;
      case 'ArrowDown':
        dy = step;
        break;
      default:
        return; // unhandled keys pass through untouched
    }
    event.preventDefault(); // the probe eats arrow scrolls, nothing else
    const res = deps.fieldResolution();
    if (res <= 0) return;
    keyX = clampField(keyX + dx, res);
    keyY = clampField(keyY + dy, res);
    report(keyX, keyY, true);
  });

  return {
    refresh(): void {
      if (lastProbe !== null) report(lastProbe.fx, lastProbe.fy, false);
    },
    destroy(): void {
      for (const dispose of disposers) dispose();
      disposers.length = 0;
      lastProbe = null;
      readout.textContent = '';
      announce.textContent = '';
      setOverlay(false);
    },
  };
}
