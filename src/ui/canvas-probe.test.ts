// @vitest-environment happy-dom
//
// Surveyor's Probe unit tests (delight pass): the static #stage skeleton is
// mounted by hand (mirroring index.html), and the world is injected — field
// arrays, live biases, and a fixed canvas rect (happy-dom rects are all zero,
// so `rect` is the one injection the DOM cannot supply). `classify`/`BIOMES`
// are the REAL pure functions: these tests assert the probe reports the
// classifier's actual answer, not a caption.
import { afterEach, describe, expect, it } from 'vitest';
import { attachCanvasProbe, PROBE_PLACEHOLDER } from './canvas-probe.ts';
import type { CanvasProbeDeps, CanvasProbeHandle } from './canvas-probe.ts';
import { NO_BIASES } from '../generation/index.ts';
import type { ClassifyBiases } from '../generation/index.ts';

/** Fixed probe canvas box: 200×200 CSS px (tests map clientX/Y through it). */
const RECT = { left: 0, top: 0, width: 200, height: 200 } as DOMRect;

interface World {
  deps: CanvasProbeDeps;
  elevation: Float32Array;
  moisture: Float32Array;
  setBiases(b: ClassifyBiases): void;
  setResolution(r: number): void;
}

/** Mutable fake world at `res`²; every field starts at (0.5, 0.5). */
function makeWorld(res: number): World {
  const elevation = new Float32Array(res * res).fill(0.5);
  const moisture = new Float32Array(res * res).fill(0.5);
  let resolution = res;
  let biases: ClassifyBiases = NO_BIASES;
  const deps: CanvasProbeDeps = {
    sample: (fx, fy) =>
      resolution > 0
        ? {
            elevation: elevation[fy * resolution + fx] ?? 0,
            moisture: moisture[fy * resolution + fx] ?? 0,
          }
        : undefined,
    fieldResolution: () => resolution,
    biases: () => biases,
    rect: () => RECT,
  };
  return {
    deps,
    elevation,
    moisture,
    setBiases: (b) => {
      biases = b;
    },
    setResolution: (r) => {
      resolution = r;
    },
  };
}

function mountSkeleton(): {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  readout: HTMLElement;
  announce: HTMLElement;
} {
  const stage = document.createElement('div');
  stage.id = 'stage';
  const canvas = document.createElement('canvas');
  canvas.id = 'map-canvas';
  const overlay = document.createElement('div');
  overlay.id = 'probe-overlay';
  overlay.hidden = true;
  for (const cls of ['probe-v', 'probe-h', 'probe-dot']) {
    const line = document.createElement('div');
    line.className = cls;
    overlay.append(line);
  }
  const readout = document.createElement('p');
  readout.id = 'probe-readout';
  const announce = document.createElement('p');
  announce.id = 'probe-announce';
  stage.append(canvas, overlay, readout, announce);
  document.body.append(stage);
  return { canvas, overlay, readout, announce };
}

function pointerMove(canvas: HTMLCanvasElement, clientX: number, clientY: number): void {
  canvas.dispatchEvent(new MouseEvent('pointermove', { clientX, clientY }));
}

function key(canvas: HTMLCanvasElement, keyName: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: keyName, shiftKey, cancelable: true });
  canvas.dispatchEvent(event);
  return event;
}

const handles: CanvasProbeHandle[] = [];

afterEach(() => {
  for (const h of handles) h.destroy();
  handles.length = 0;
  for (const stale of document.querySelectorAll('#stage')) stale.remove();
});

describe('surveyor\'s probe (pointer)', () => {
  it('reports position, field values, and the classifier\'s biome name', () => {
    const { canvas, readout, overlay } = mountSkeleton();
    const world = makeWorld(4);
    handles.push(attachCanvasProbe(canvas, world.deps));

    // 200×200 CSS px over a 4×4 field: clientX 100 → fx 2, clientY 50 → fy 1.
    world.elevation[1 * 4 + 2] = 0.75;
    world.moisture[1 * 4 + 2] = 0.6; // highland + humid → Forest
    pointerMove(canvas, 100, 50);
    expect(readout.textContent).toBe('2, 1 · elev 0.75 · moist 0.60 · Forest');
    expect(overlay.hidden).toBe(false);

    // Regression (polish pass): the FIRST reading after idle — the overlay is
    // still hidden when it starts — must position the crosshair from the
    // canvas box, not the overlay's pre-layout clientWidth (which parked the
    // reticle at 0,0 in the wild). 200×200 CSS px over a 4×4 field:
    // fx 2 → (2.5/4)·200 = 125px, fy 1 → (1.5/4)·200 = 75px.
    const dot = overlay.querySelector<HTMLElement>('.probe-dot');
    const lineV = overlay.querySelector<HTMLElement>('.probe-v');
    const lineH = overlay.querySelector<HTMLElement>('.probe-h');
    expect(dot?.style.left).toBe('125px');
    expect(dot?.style.top).toBe('75px');
    expect(lineV?.style.left).toBe('125px');
    expect(lineH?.style.top).toBe('75px');
  });

  it('pointerleave PARKS the instrument — the reading survives for refresh() (harden)', () => {
    const { canvas, readout, overlay } = mountSkeleton();
    const world = makeWorld(4);
    handles.push(attachCanvasProbe(canvas, world.deps));
    world.elevation[1 * 4 + 2] = 0.75;
    world.moisture[1 * 4 + 2] = 0.6;
    pointerMove(canvas, 100, 50);
    expect(readout.textContent).toBe('2, 1 · elev 0.75 · moist 0.60 · Forest');

    // Leaving for the moisture dial parks the station — crosshair AND reading
    // stay. Retracting here is what made the coupling unreachable (P1-1).
    canvas.dispatchEvent(new Event('pointerleave'));
    expect(readout.textContent).toBe('2, 1 · elev 0.75 · moist 0.60 · Forest');
    expect(overlay.hidden).toBe(false);
    const dot = overlay.querySelector<HTMLElement>('.probe-dot');
    expect(dot?.style.left).toBe('125px'); // crosshair did not move
  });

  it('harden P1-1: refresh() re-reports the parked station under new biases (no announce)', () => {
    const { canvas, readout, announce } = mountSkeleton();
    const world = makeWorld(4);
    const probe = attachCanvasProbe(canvas, world.deps);
    handles.push(probe);
    world.elevation[1 * 4 + 2] = 0.75;
    world.moisture[1 * 4 + 2] = 0.6; // Forest at neutral bias

    pointerMove(canvas, 100, 50);
    expect(readout.textContent).toBe('2, 1 · elev 0.75 · moist 0.60 · Forest');

    // The surveyor walks to the moisture dial (leave parks), turns it, and
    // the SAME pixel is re-named through the live getters.
    canvas.dispatchEvent(new Event('pointerleave'));
    world.setBiases({ seaLevelBias: 0, moistureBias: 0.3 }); // m 0.6 → 0.9 → Taiga
    probe.refresh();
    expect(readout.textContent).toBe('2, 1 · elev 0.75 · moist 0.60 · Taiga');
    expect(announce.textContent).toBe(''); // refreshes are visible-only
  });

  it('refresh() with no station (fields never arrived) is a no-op', () => {
    const { canvas, readout, overlay } = mountSkeleton();
    const world = makeWorld(0);
    const probe = attachCanvasProbe(canvas, world.deps);
    handles.push(probe);
    probe.refresh();
    expect(readout.textContent).toBe(PROBE_PLACEHOLDER);
    expect(overlay.hidden).toBe(true);
  });

  it('stays dark before any fields exist (boot race / dead stack) — placeholder shows', () => {
    const { canvas, readout, overlay } = mountSkeleton();
    const world = makeWorld(0);
    handles.push(attachCanvasProbe(canvas, world.deps));
    expect(readout.textContent).toBe(PROBE_PLACEHOLDER); // the empty state
    pointerMove(canvas, 100, 50);
    expect(readout.textContent).toBe(PROBE_PLACEHOLDER); // still nothing truer to say
    expect(overlay.hidden).toBe(true);
  });

  it('onboard: the line starts as the teaching placeholder, then a reading replaces it for good', () => {
    const { canvas, readout } = mountSkeleton();
    const world = makeWorld(4);
    const probe = attachCanvasProbe(canvas, world.deps);
    handles.push(probe);
    expect(readout.textContent).toBe(PROBE_PLACEHOLDER);

    pointerMove(canvas, 100, 50);
    expect(readout.textContent).not.toBe(PROBE_PLACEHOLDER);

    // Parking means a reading never yields the line back — the placeholder
    // is strictly the pre-first-use empty state.
    canvas.dispatchEvent(new Event('pointerleave'));
    expect(readout.textContent).not.toBe(PROBE_PLACEHOLDER);
  });

  it('live biases change the reading: the moisture slider re-names the pixel', () => {
    const { canvas, readout } = mountSkeleton();
    const world = makeWorld(4);
    handles.push(attachCanvasProbe(canvas, world.deps));
    world.elevation[6] = 0.75;
    world.moisture[6] = 0.6; // Forest at neutral bias

    pointerMove(canvas, 100, 50);
    expect(readout.textContent).toContain('Forest');

    world.setBiases({ seaLevelBias: 0, moistureBias: 0.3 }); // m 0.6 → 0.9 → Taiga
    pointerMove(canvas, 101, 51);
    expect(readout.textContent).toContain('Taiga');
  });
});

describe('surveyor\'s probe (keyboard)', () => {
  it('focus probes the center and announces politely; arrows step, Shift ×8, edges clamp', () => {
    const { canvas, readout, announce, overlay } = mountSkeleton();
    const world = makeWorld(4);
    handles.push(attachCanvasProbe(canvas, world.deps));
    world.elevation.fill(0.2);
    world.moisture.fill(0.2); // deep ocean everywhere

    canvas.dispatchEvent(new Event('focus'));
    expect(readout.textContent).toBe('2, 2 · elev 0.20 · moist 0.20 · Deep Ocean');
    expect(announce.textContent).toBe('Deep Ocean at 2, 2 — elevation 0.20, moisture 0.20');
    expect(overlay.hidden).toBe(false);

    const left = key(canvas, 'ArrowLeft');
    expect(readout.textContent).toBe('1, 2 · elev 0.20 · moist 0.20 · Deep Ocean');
    expect(left.defaultPrevented).toBe(true); // the probe eats arrow scrolls

    key(canvas, 'ArrowUp', true); // Shift ×8 from (1, 2) → clamps to y 0
    expect(readout.textContent).toBe('1, 0 · elev 0.20 · moist 0.20 · Deep Ocean');
    expect(announce.textContent).toBe('Deep Ocean at 1, 0 — elevation 0.20, moisture 0.20');

    key(canvas, 'ArrowRight', true); // ×8 from x 1 → clamps to x 3
    expect(readout.textContent).toBe('3, 0 · elev 0.20 · moist 0.20 · Deep Ocean');
  });

  it('unhandled keys pass through untouched (no preventDefault)', () => {
    const { canvas } = mountSkeleton();
    const world = makeWorld(4);
    handles.push(attachCanvasProbe(canvas, world.deps));
    canvas.dispatchEvent(new Event('focus'));
    const tab = key(canvas, 'Tab');
    expect(tab.defaultPrevented).toBe(false);
  });

  it('blur PARKS the reading; arrow keys gate off until focus returns (harden)', () => {
    const { canvas, readout, overlay } = mountSkeleton();
    const world = makeWorld(4);
    const probe = attachCanvasProbe(canvas, world.deps);
    handles.push(probe);
    world.elevation.fill(0.2);
    world.moisture.fill(0.2); // deep ocean everywhere

    canvas.dispatchEvent(new Event('focus'));
    key(canvas, 'ArrowLeft'); // station parks at 1, 2
    canvas.dispatchEvent(new Event('blur'));

    // Focus moved to a slider: the reading stays (the coupling path)…
    expect(readout.textContent).toBe('1, 2 · elev 0.20 · moist 0.20 · Deep Ocean');
    expect(overlay.hidden).toBe(false);

    // …but arrow keys no longer move the probe while unfocused.
    key(canvas, 'ArrowRight');
    expect(readout.textContent).toBe('1, 2 · elev 0.20 · moist 0.20 · Deep Ocean');

    // Refresh still re-reads the parked keyboard station (dial turned:
    // e 0.2 + 0.35 sea bias → dry land — no longer Deep Ocean).
    world.setBiases({ seaLevelBias: 0.35, moistureBias: 0 });
    probe.refresh();
    expect(readout.textContent).not.toContain('Deep Ocean'); // re-named in place
  });
});

describe('surveyor\'s probe (lifecycle)', () => {
  it('destroy detaches every listener — later events are ignored', () => {
    const { canvas, readout } = mountSkeleton();
    const world = makeWorld(4);
    const probe = attachCanvasProbe(canvas, world.deps);
    probe.destroy();
    pointerMove(canvas, 100, 50);
    canvas.dispatchEvent(new Event('focus'));
    key(canvas, 'ArrowLeft');
    expect(readout.textContent).toBe(PROBE_PLACEHOLDER); // back to the empty state
  });
});
