// @vitest-environment happy-dom
//
// T11 first-load experience tests for startApp: boot (bare vs stateful URL),
// animation routing by fields-cause, sticky preset id, reduced-motion env
// forwarding, and the rebuild/retry shared-state restore. Everything effectful
// is injected: a fake controller (manual emitter + call log), a fake animation
// (play/skip counters), a fake location (records replaceState), and a manual
// writer scheduler (fire the coalescing timer by hand). The panel is the REAL
// panel, so preset clicks exercise the full wiring chain.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startApp, DEFAULT_BOOT_PRESET, bareBootState } from './app.ts';
import type {
  AppHandle,
  AppAnimationPort,
  AppControllerPort,
  ProbeRendererPort,
  StartAppOptions,
} from './app.ts';
import type { AnimationEnv, AnimationRendererPort, AnimationStage } from './render/animation.ts';
import type { ControlPanelHandle, PanelControllerEvent } from './ui/control-panel.ts';
import type { ControlState } from './controller/map-controller.ts';
import type { PresetDefinition } from './presets/index.ts';
import { findPreset } from './presets/index.ts';
import { DEFAULT_FIELD_PARAMS, NO_BIASES, BIOME_IDS } from './generation/index.ts';
import type { ClassifyBiases, FieldParams } from './generation/index.ts';
import { PROBE_PLACEHOLDER } from './ui/canvas-probe.ts';
import { parseHashBody } from './state/urlState.ts';
import type { LocationPort } from './state/urlState.ts';

/**
 * MapController's param merge (map-controller.ts `fieldParams`, committed in
 * T6/T12): seed-independent defaults, the two slider-derived keys, then the
 * preset overrides win for the keys they carry. Local replica so the app test
 * can assert WHAT the boot config is without instantiating the real
 * controller (same pattern as fields.test.ts's `controllerFieldParams`).
 */
function mergeControllerParams(
  elevation: number,
  overrides: Partial<FieldParams> | null,
): FieldParams {
  return {
    ...DEFAULT_FIELD_PARAMS,
    elevationFreq: 2.5 + 2 * elevation,
    redistribution: 1.2 + 0.6 * elevation,
    ...(overrides ?? {}),
  };
}

type SharedApply = {
  seed: number;
  elevation: number;
  moisture: number;
  presetId: string | null;
};

/**
 * Faithful-enough controller double: mutates `state`, mirrors the real
 * override semantics (applyPreset/applySharedState install, setElevation
 * clears), and emits the same state/fields/error/preview events the real
 * controller would.
 */
class FakeController implements AppControllerPort {
  state: ControlState = { seed: 0, elevation: 0.5, moisture: 0.5 };
  hasOverrides = false;
  biases: ClassifyBiases = NO_BIASES;
  readonly sharedCalls: SharedApply[] = [];
  readonly otherCalls: string[] = [];
  private readonly listeners = new Set<(e: PanelControllerEvent) => void>();

  applySharedState(s: SharedApply): void {
    this.sharedCalls.push({ ...s });
    this.state = { seed: s.seed, elevation: s.elevation, moisture: s.moisture };
    this.hasOverrides = findPreset(s.presetId) !== null;
    this.emitState();
  }

  applyPreset(preset: PresetDefinition): void {
    this.otherCalls.push(`applyPreset:${preset.id}`);
    this.state = { ...this.state, elevation: preset.elevation, moisture: preset.moisture };
    this.hasOverrides = true;
    this.emitState();
  }

  regenerate(seed?: number): void {
    this.otherCalls.push('regenerate');
    if (seed !== undefined) {
      this.state = { ...this.state, seed };
      this.emitState();
    }
  }

  setSeed(seed: number): void {
    this.otherCalls.push('setSeed');
    this.state = { ...this.state, seed };
    this.emitState();
  }

  setElevation(v: number): void {
    this.otherCalls.push('setElevation');
    this.state = { ...this.state, elevation: v };
    this.hasOverrides = false; // manual terrain input clears overrides (real semantics)
    this.emitState();
  }

  commitElevation(): void {
    this.otherCalls.push('commitElevation');
  }

  setMoisture(v: number): void {
    this.otherCalls.push('setMoisture');
    this.state = { ...this.state, moisture: v };
    this.emitState();
  }

  setAnimationCancel(_hook: () => boolean): void {
    this.otherCalls.push('setAnimationCancel');
  }

  subscribe(fn: (e: PanelControllerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  dispose(): void {
    this.otherCalls.push('dispose');
  }

  emit(e: PanelControllerEvent): void {
    for (const listener of [...this.listeners]) listener(e);
  }

  emitState(): void {
    this.emit({ type: 'state', state: { ...this.state } });
  }
}

/** Animation double: records play/skip/dispose, never schedules anything. */
class FakeAnimation implements AppAnimationPort {
  playCount = 0;
  skipCount = 0;
  disposeCount = 0;
  playing = false;
  private readonly listeners = new Set<(s: AnimationStage) => void>();

  play(): Promise<AnimationStage> {
    this.playCount += 1;
    return Promise.resolve('done');
  }

  skip(): void {
    this.skipCount += 1;
  }

  dispose(): void {
    this.disposeCount += 1;
  }

  onStageChange(cb: (s: AnimationStage) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Test hook: fire a stage announcement through the wired listeners. */
  emitStage(s: AnimationStage): void {
    for (const listener of [...this.listeners]) listener(s);
  }
}

/** Renderer double: satisfies the animation + probe ports, counts calls. */
class FakeRenderer implements AnimationRendererPort, ProbeRendererPort {
  draws = 0;
  crossfades = 0;
  /** Probe surface: resolution + sample the smoke test sets by hand. */
  nextResolution = 0;
  nextSample: { elevation: number; moisture: number } | undefined = undefined;
  get fieldResolution(): number {
    return this.nextResolution;
  }
  sample(): { elevation: number; moisture: number } | undefined {
    return this.nextSample;
  }
  draw(): void {
    this.draws += 1;
  }
  crossfade(): void {
    this.crossfades += 1;
  }
}

/** Location double: fixed hash + every replaceState URL recorded. */
class FakeLocation implements LocationPort {
  readonly urls: string[] = [];
  constructor(readonly hash: string) {}
  replaceState(url: string): void {
    this.urls.push(url);
  }
}

/** Manual timer queue for the coalescing URL writer (fire by hand). */
class ManualScheduler {
  private readonly queue: Array<() => void> = [];
  readonly schedule = (fn: () => void, _ms: number): unknown => {
    this.queue.push(fn);
    return this.queue.length;
  };
  readonly cancel = (_handle: unknown): void => {
    /* inert: fire() is a no-op once the writer's pending state is drained */
  };
  fire(): void {
    const fn = this.queue.shift();
    fn?.();
  }
  fireAll(): void {
    while (this.queue.length > 0) this.fire();
  }
}

interface Harness {
  handle: AppHandle;
  controller: FakeController;
  renderer: FakeRenderer;
  animations: FakeAnimation[];
  capturedEnvs: AnimationEnv[];
  loc: FakeLocation;
  scheduler: ManualScheduler;
  panel: ControlPanelHandle;
  canvas: HTMLCanvasElement;
}

const containers: HTMLElement[] = [];

function boot(
  hash: string,
  animationEnv?: AnimationEnv,
  extra: Partial<StartAppOptions> = {},
): Harness {
  const controller = new FakeController();
  const renderer = new FakeRenderer();
  const animations: FakeAnimation[] = [];
  const capturedEnvs: AnimationEnv[] = [];
  const loc = new FakeLocation(hash);
  const scheduler = new ManualScheduler();
  // Probe skeleton (mirrors index.html's #stage): one per boot — the probe
  // queries the document, so stale skeletons from earlier boots are removed.
  for (const stale of document.querySelectorAll('#stage')) stale.remove();
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
  const statusHost = document.createElement('div');
  statusHost.id = 'stage-status'; // mirrors index.html (stage label lives here)
  const legend = document.createElement('details'); // mirrors index.html (map key)
  legend.id = 'biome-legend';
  const swatchesHost = document.createElement('div');
  swatchesHost.id = 'legend-swatches';
  legend.append(swatchesHost);
  const announce = document.createElement('p');
  announce.id = 'probe-announce';
  announce.setAttribute('aria-live', 'polite'); // mirrors index.html
  announce.className = 'visually-hidden';
  stage.append(canvas, overlay, statusHost, readout, legend, announce);
  document.body.append(stage);
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const handle = startApp(canvas, container, {
    createBundle: () => ({ controller, renderer }),
    createAnimation: (r, env) => {
      capturedEnvs.push(env);
      expect(r).toBe(renderer);
      const animation = new FakeAnimation();
      animations.push(animation);
      return animation;
    },
    loc,
    writerOptions: { schedule: scheduler.schedule, cancel: scheduler.cancel },
    animationEnv,
    ...extra,
  });
  return {
    handle,
    controller,
    renderer,
    animations,
    capturedEnvs,
    loc,
    scheduler,
    panel: handle.panel,
    canvas,
  };
}

/** Drain the share/export promise chains (a few microtask ticks each). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function presetButton(h: Harness, id: string): HTMLButtonElement {
  const button = h.panel.elements.presetButtons.find((b) => b.dataset.preset === id);
  if (button === undefined) throw new Error(`preset button not found: ${id}`);
  return button;
}

afterEach(() => {
  for (const c of containers) c.remove();
  containers.length = 0;
  for (const stale of document.querySelectorAll('#stage')) stale.remove();
  vi.restoreAllMocks();
});

describe('surveyor\'s probe wiring (delight)', () => {
  it('boots with the stage label hosted in the #stage-status caption block (layout pass)', () => {
    boot('');
    const hosted = document.querySelector('#stage-status #stage-label');
    expect(hosted).not.toBeNull(); // map status lives with the map
    expect(hosted?.getAttribute('aria-live')).toBe('polite');
  });

  it('onboard: boot populates the legend from the committed palette; the readout line teaches', () => {
    boot('');
    // The key is data-driven — one entry per committed biome, in palette order.
    const entries = document.querySelectorAll('#legend-swatches .legend-entry');
    expect(entries).toHaveLength(BIOME_IDS.length);
    // The readout starts as the placeholder empty state (pre-first-probe).
    const readout = document.querySelector<HTMLElement>('#probe-readout');
    expect(readout?.textContent).toBe(PROBE_PLACEHOLDER);
  });

  it('polish: while the reveal plays the canvas carries the skip affordance; done returns it to the probe', () => {
    const h = boot('');
    h.animations[0]!.emitStage('elevation');
    expect(h.canvas.classList.contains('revealing')).toBe(true);
    expect(h.canvas.getAttribute('aria-busy')).toBe('true');
    expect(h.canvas.title).toBe('Click to skip the reveal');

    h.animations[0]!.emitStage('done');
    expect(h.canvas.classList.contains('revealing')).toBe(false);
    expect(h.canvas.getAttribute('aria-busy')).toBe('false');
    expect(h.canvas.title).toBe('');
  });

  it('focus + arrow keys probe the live renderer: reading + announcement; blur clears', () => {
    const h = boot('');
    const readout = document.querySelector<HTMLElement>('#probe-readout');
    const announce = document.querySelector<HTMLElement>('#probe-announce');
    const overlay = document.querySelector<HTMLElement>('#probe-overlay');
    expect(readout).not.toBeNull();
    expect(announce?.getAttribute('aria-live')).toBe('polite');
    expect(overlay?.hasAttribute('hidden')).toBe(true);

    // No fields yet (boot race): the instrument stays dark, the line teaches.
    h.canvas.dispatchEvent(new Event('focus'));
    expect(readout!.textContent).toBe(PROBE_PLACEHOLDER);
    expect(overlay?.hasAttribute('hidden')).toBe(true);

    // Fields land: focus probes the center of a 4×4 field, announcing the
    // classifier's answer through the polite live region.
    h.renderer.nextResolution = 4;
    h.renderer.nextSample = { elevation: 0.75, moisture: 0.6 }; // → Forest
    h.canvas.dispatchEvent(new Event('focus'));
    expect(readout!.textContent).toBe('2, 2 · elev 0.75 · moist 0.60 · Forest');
    expect(announce!.textContent).toBe('Forest at 2, 2 — elevation 0.75, moisture 0.60');
    expect(overlay?.hasAttribute('hidden')).toBe(false);

    // Arrow keys step the probe (Shift = ×8) and re-report.
    h.canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    expect(readout!.textContent).toBe('1, 2 · elev 0.75 · moist 0.60 · Forest');
    h.canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, cancelable: true }),
    );
    expect(readout!.textContent).toBe('1, 0 · elev 0.75 · moist 0.60 · Forest');

    // Harden: blur PARKS the instrument — the reading survives moving focus
    // to the sliders (the probe/moisture coupling depends on it).
    h.canvas.dispatchEvent(new Event('blur'));
    expect(readout!.textContent).toBe('1, 0 · elev 0.75 · moist 0.60 · Forest');
    expect(overlay?.hasAttribute('hidden')).toBe(false);
  });

  it('harden P1-1: controller state events refresh the parked probe — the moisture dial re-names the pixel', () => {
    const h = boot('');
    const readout = document.querySelector<HTMLElement>('#probe-readout');
    h.renderer.nextResolution = 4;
    h.renderer.nextSample = { elevation: 0.75, moisture: 0.6 }; // Forest

    // Park a station (keyboard focus probes the center of the 4×4 field),
    // then walk away to the sliders — blur no longer retracts the reading.
    h.canvas.dispatchEvent(new Event('focus'));
    expect(readout!.textContent).toContain('Forest');
    h.canvas.dispatchEvent(new Event('blur'));

    // The moisture dial turns: the controller's state event re-reads the
    // SAME station through the live bias getter (app.ts wires the refresh).
    h.controller.biases = { seaLevelBias: 0, moistureBias: 0.3 }; // m 0.6 → 0.9
    h.controller.emit({ type: 'state', state: { seed: 0, elevation: 0.3, moisture: 0.8 } });
    expect(readout!.textContent).toBe('2, 2 · elev 0.75 · moist 0.60 · Taiga');
  });
});

describe('startApp (T11 first-load experience)', () => {
  describe('boot', () => {
    it('(a) bare URL: continent preset OWN positions, default seed, one applySharedState, no other churn, URL written', () => {
      const h = boot('');
      const continent = findPreset('continent');

      // T3c-fix: a bare boot is exactly a Continent preset click at seed 0 —
      // the preset's calibrated slider positions (0.3/0.5), not the centered
      // DEFAULT_SHARED_STATE sliders the old hybrid boot used.
      expect(continent).not.toBeNull();
      expect(h.controller.sharedCalls).toEqual([
        {
          seed: 0,
          elevation: continent!.elevation,
          moisture: continent!.moisture,
          presetId: DEFAULT_BOOT_PRESET,
        },
      ]);
      expect(DEFAULT_BOOT_PRESET).toBe('continent');
      // No other controller churn: the only non-boot call is the animation
      // cancel hook every stack registers at build time.
      expect(h.controller.otherCalls).toEqual(['setAnimationCancel']);
      expect(h.handle.getActivePreset()).toBe('continent');

      h.scheduler.fire(); // coalescing window closes → one replaceState
      expect(h.loc.urls).toHaveLength(1);
      expect(h.loc.urls[0]).toBe('#v=1&seed=0&el=0.3&mo=0.5&preset=continent');
    });

    it('(a2) bare-boot state IS the continent preset state; merged boot params are the calibrated continent config', () => {
      // State identity: bareBootState() carries the preset's own snapshot.
      const continent = findPreset('continent')!;
      expect(bareBootState()).toEqual({
        version: 1,
        seed: 0,
        elevation: continent.elevation,
        moisture: continent.moisture,
        preset: continent.id,
      });

      // The boot map config: merging the boot state exactly as MapController
      // does (defaults → slider-derived keys → preset overrides win) must
      // equal the T3c-calibrated continent merge — the config whose ratio +
      // coherence invariants fields.test.ts pins (boot seed 0 included in
      // both sweeps; see the "T3c-fix boot config" describe there).
      const bootParams = mergeControllerParams(bareBootState().elevation, continent.overrides);
      expect(bootParams).toEqual(mergeControllerParams(continent.elevation, continent.overrides));
      expect(bootParams.redistribution).toBeCloseTo(1.38, 10); // slider 0.3, not the old 1.5
      expect(bootParams.falloffStrength).toBe(0.08);
      expect(bootParams.elevationFreq).toBe(2.72);

      // Same-URL → same-map: the hash a bare boot writes parses back to the
      // boot state, so reloading it regenerates the identical map.
      const h = boot('');
      h.scheduler.fire();
      const written = h.loc.urls[0] ?? '';
      expect(parseHashBody(written.replace(/^#/, ''))).toEqual(bareBootState());

      // Sticky-id semantics: booting at the preset's own positions installs
      // overrides (not a manual terrain input) → the id survives boot.
      expect(h.controller.hasOverrides).toBe(true);
      expect(h.handle.getActivePreset()).toBe('continent');
    });

    it('(b) stateful URL: restores seed/sliders/preset via one applySharedState', () => {
      const h = boot('#v=1&seed=42&el=0.8&mo=0.3&preset=archipelago');

      expect(h.controller.sharedCalls).toEqual([
        { seed: 42, elevation: 0.8, moisture: 0.3, presetId: 'archipelago' },
      ]);
      expect(h.controller.otherCalls).toEqual(['setAnimationCancel']); // hook wiring only
      expect(h.handle.getActivePreset()).toBe('archipelago');

      h.scheduler.fire();
      expect(h.loc.urls.at(-1)).toBe('#v=1&seed=42&el=0.8&mo=0.3&preset=archipelago');
    });

    it('(b2) stateful URL with a pattern-valid but unregistered preset id boots pure slider params and a null id', () => {
      const h = boot('#v=1&seed=5&el=0.6&mo=0.4&preset=unregistered');
      expect(h.controller.sharedCalls).toEqual([
        { seed: 5, elevation: 0.6, moisture: 0.4, presetId: 'unregistered' },
      ]);
      // The fake mirrors the real findPreset miss: no overrides → sticky-off.
      expect(h.controller.hasOverrides).toBe(false);
      expect(h.handle.getActivePreset()).toBeNull();
      h.scheduler.fire();
      expect(h.loc.urls.at(-1)).toBe('#v=1&seed=5&el=0.6&mo=0.4');
    });
  });

  describe('animation routing', () => {
    it("(c) generate-cause fields arrivals play the staged animation; elevation-commit and preview never do", () => {
      const h = boot('');
      const animation = h.animations[0];
      if (animation === undefined) throw new Error('boot built no animation');

      h.controller.emit({ type: 'fields', final: true, cause: 'generate' });
      expect(animation.playCount).toBe(1);

      h.controller.emit({ type: 'fields', final: true, cause: 'elevation-commit' });
      h.controller.emit({ type: 'preview' });
      expect(animation.playCount).toBe(1); // instant paths stay instant

      h.controller.emit({ type: 'fields', final: true, cause: 'generate' });
      expect(animation.playCount).toBe(2);
    });

    it('(e) reduced motion: env forwarded to the animation factory and play() still fires once (announcements)', () => {
      const h = boot('', { prefersReducedMotion: true });
      expect(h.capturedEnvs[0]?.prefersReducedMotion).toBe(true);

      h.controller.emit({ type: 'fields', final: true, cause: 'generate' });
      expect(h.animations[0]?.playCount).toBe(1); // real StagedAnimation draws immediately (T8)
    });
  });

  describe('(d) sticky preset id', () => {
    it('set on preset click; survives moisture tweaks; clears on elevation input (even drag-back); URL follows', () => {
      const h = boot('');

      // Preset click drives the full chain: panel → app port → controller.
      presetButton(h, 'continent').click();
      expect(h.handle.getActivePreset()).toBe('continent');
      expect(h.controller.otherCalls).toContain('applyPreset:continent');

      // Moisture tweak: overrides still live → id stays (T12 corner b).
      h.controller.setMoisture(0.7);
      expect(h.handle.getActivePreset()).toBe('continent');

      h.scheduler.fireAll();
      expect(h.loc.urls.at(-1)).toBe('#v=1&seed=0&el=0.3&mo=0.7&preset=continent');

      // Elevation drag clears overrides → id null, and dragging BACK to the
      // preset's exact slider values must NOT re-mark it (T12 corner a).
      // (el=0.3 = T3c recalibrated continent slider position.)
      h.controller.setElevation(0.3);
      expect(h.handle.getActivePreset()).toBeNull();
      h.controller.setElevation(0.41);
      expect(h.handle.getActivePreset()).toBeNull();

      h.scheduler.fireAll();
      const last = h.loc.urls.at(-1);
      expect(last).toBe('#v=1&seed=0&el=0.41&mo=0.7');
      expect(last?.includes('preset=')).toBe(false);
    });

    it('clarify P1-2: the pressed chip reads the same sticky id as the URL — lockstep, never slider coincidence', () => {
      const h = boot('');
      const continentChip = h.panel.elements.presetButtons.find(
        (b) => b.dataset.preset === 'continent',
      )!;
      expect(continentChip.getAttribute('aria-pressed')).toBe('true'); // boot preset

      // Moisture tuned far off the preset's sliders: chip STAYS pressed and
      // the URL keeps the preset — one truth, both directions.
      h.controller.setMoisture(0.95);
      h.scheduler.fireAll();
      expect(continentChip.getAttribute('aria-pressed')).toBe('true');
      expect(h.loc.urls.at(-1)).toContain('preset=continent');

      // Elevation input clears overrides upstream: chip and URL drop it together.
      h.controller.setElevation(0.4);
      h.scheduler.fireAll();
      expect(continentChip.getAttribute('aria-pressed')).toBe('false');
      expect(h.loc.urls.at(-1)?.includes('preset=')).toBe(false);

      // Dragging back to the preset's exact sliders must NOT re-press the
      // chip — coincidence is not selection.
      h.controller.setElevation(0.3);
      h.controller.setMoisture(0.5);
      h.scheduler.fireAll();
      expect(continentChip.getAttribute('aria-pressed')).toBe('false');
    });

    it('seed changes flow into the URL through the same state-event push', () => {
      const h = boot('');
      h.controller.setSeed(4242);
      h.scheduler.fireAll();
      expect(h.loc.urls.at(-1)).toBe('#v=1&seed=4242&el=0.3&mo=0.5&preset=continent');
    });

    it('clarify P1-2 (boot order): a stateful URL restores sliders, seed field, AND chip — not build defaults', () => {
      const h = boot('#v=1&seed=9&el=0.8&mo=0.25&preset=highlands');
      const el = h.panel.elements.elevationInput as HTMLInputElement;
      const mo = h.panel.elements.moistureInput as HTMLInputElement;
      expect(el.value).toBe('0.8'); // the sharer's terrain, not the panel default
      expect(mo.value).toBe('0.25');
      expect(h.panel.elements.seedInput.value).toBe('9');
      const chip = h.panel.elements.presetButtons.find((b) => b.dataset.preset === 'highlands')!;
      expect(chip.getAttribute('aria-pressed')).toBe('true');

      // Bare boot: continent chip pressed, preset's own slider positions.
      const bare = boot('');
      const continentChip = bare.panel.elements.presetButtons.find(
        (b) => b.dataset.preset === 'continent',
      )!;
      expect(continentChip.getAttribute('aria-pressed')).toBe('true');
      expect((bare.panel.elements.elevationInput as HTMLInputElement).value).toBe('0.3');
    });
  });

  describe('(f) retry / rebuild', () => {
    it('error → Retry rebuilds and re-applies the LAST FULL shared state (not just the seed)', () => {
      const h = boot('');
      // User journey after boot: custom terrain + new seed + climate tweak.
      h.controller.setElevation(0.7);
      h.controller.setSeed(42);
      h.controller.setMoisture(0.3);
      h.scheduler.fireAll();
      expect(h.loc.urls.at(-1)).toBe('#v=1&seed=42&el=0.7&mo=0.3'); // preset fell off (elevation drag)

      // Worker dies → panel error → Retry click → onRetry → rebuild.
      h.controller.emit({ type: 'error', error: new Error('worker died') });
      h.panel.elements.retryButton.click();

      // T16-fix (F2): rebuild must dispose the OLD stack first — with the
      // real bundle that dispose now terminates the old worker client
      // (wired in createMapController), so retries leak zero live workers.
      expect(h.controller.otherCalls).toContain('dispose');
      expect(h.controller.sharedCalls).toHaveLength(2); // boot + rebuild
      expect(h.controller.sharedCalls[1]).toEqual({
        seed: 42,
        elevation: 0.7,
        moisture: 0.3,
        presetId: null,
      });
      expect(h.animations.length).toBe(2); // fresh animation per stack
    });

    it('retry while a preset is active restores the preset id too (overrides re-installed)', () => {
      const h = boot('');
      presetButton(h, 'archipelago').click();
      h.controller.setMoisture(0.6); // climate tweak keeps the id
      h.scheduler.fireAll();

      h.controller.emit({ type: 'error', error: new Error('boom') });
      h.panel.elements.retryButton.click();

      expect(h.controller.sharedCalls.at(-1)).toMatchObject({ presetId: 'archipelago' });
      expect(h.handle.getActivePreset()).toBe('archipelago');
      h.scheduler.fireAll();
      expect(h.loc.urls.at(-1)).toBe('#v=1&seed=0&el=0.85&mo=0.6&preset=archipelago');
    });
  });

  describe('dispose (additive)', () => {
    it('flushes the pending URL write, tears the animation down, and leaves the fired timer inert', () => {
      const h = boot('');
      h.controller.setSeed(9);
      h.loc.urls.length = 0; // drop the (still coalesced) boot write

      h.handle.dispose();

      expect(h.loc.urls).toEqual(['#v=1&seed=9&el=0.3&mo=0.5&preset=continent']); // flushed
      expect(h.animations[0]?.disposeCount).toBe(1);
      expect(h.controller.otherCalls).toContain('dispose');

      h.scheduler.fireAll(); // cancelled+drained timer must not double-write
      expect(h.loc.urls).toHaveLength(1);
    });
  });

  describe('ports still forward (regression)', () => {
    it('panel controls reach the controller through the rebuilt-shim ports', () => {
      const h = boot('');
      const el = h.panel.elements.elevationInput;
      el.value = '0.8';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      expect(h.controller.otherCalls).toContain('setElevation');
      expect(h.controller.state.elevation).toBe(0.8);

      h.panel.elements.generateButton.click();
      expect(h.controller.otherCalls).toContain('regenerate');
    });
  });

  describe('T14 share', () => {
    it('flushes the coalescing URL write BEFORE copying, then flashes on success', async () => {
      const clipboardCalls: Array<{ text: string; urlsAtCall: number }> = [];
      const h = boot('', undefined, {
        clipboard: (text) => {
          clipboardCalls.push({ text, urlsAtCall: h.loc.urls.length });
          return Promise.resolve(true);
        },
      });

      h.controller.setSeed(7); // arms the writer; the coalescing timer is NOT fired
      expect(h.loc.urls).toHaveLength(0); // still pending

      h.panel.elements.shareButton.click();
      // The flush (replaceState) landed before the clipboard was touched, and
      // the copied URL carries the fresh seed — not the up-to-200ms-stale hash.
      expect(clipboardCalls).toHaveLength(1);
      expect(clipboardCalls[0]?.urlsAtCall).toBe(1);
      expect(clipboardCalls[0]?.text).toBe(
        'http://localhost:3000/#v=1&seed=7&el=0.3&mo=0.5&preset=continent',
      );
      expect(h.loc.urls).toEqual(['#v=1&seed=7&el=0.3&mo=0.5&preset=continent']);

      await flushMicrotasks();
      expect(h.panel.elements.shareButton.textContent).toBe('Link copied');
      expect(h.panel.elements.shareFallback.hidden).toBe(true);
    });

    it('clipboard unavailable → execCommand textarea fallback copies and flashes', async () => {
      const execCommands: string[] = [];
      const h = boot('', undefined, {
        clipboard: () => Promise.resolve(false), // feature-detect miss / rejection
        execCommand: (command) => {
          execCommands.push(command);
          return true;
        },
      });

      h.panel.elements.shareButton.click();
      await flushMicrotasks();

      expect(execCommands).toEqual(['copy']);
      expect(h.panel.elements.shareButton.textContent).toBe('Link copied');
      expect(h.panel.elements.shareFallback.hidden).toBe(true); // legacy path worked
    });

    it('both copy paths fail → selectable fallback region shows the built URL; no flash', async () => {
      const h = boot('', undefined, {
        clipboard: () => Promise.resolve(false),
        execCommand: () => false,
      });
      const { shareFallback, shareButton } = h.panel.elements;
      expect(shareFallback.hidden).toBe(true);

      shareButton.click();
      await flushMicrotasks();

      expect(shareFallback.hidden).toBe(false);
      const input = shareFallback.querySelector<HTMLInputElement>('input');
      expect(input?.readOnly).toBe(true);
      // Default getShareUrl: adapter base (happy-dom default location) + the
      // canonical serialization of the boot state.
      expect(input?.value).toBe(
        'http://localhost:3000/#v=1&seed=0&el=0.3&mo=0.5&preset=continent',
      );
      expect(shareButton.textContent).toBe('Copy link'); // no success flash on failure
    });

    it('getShareUrl injection replaces the URL builder verbatim', async () => {
      const h = boot('', undefined, {
        clipboard: () => Promise.resolve(false),
        execCommand: () => false,
        getShareUrl: () => 'https://example.test/x#v=1&seed=0',
      });

      h.panel.elements.shareButton.click();
      await flushMicrotasks();

      const input = h.panel.elements.shareFallback.querySelector<HTMLInputElement>('input');
      expect(input?.value).toBe('https://example.test/x#v=1&seed=0');
    });
  });

  describe('T14 export', () => {
    it('downloads biome-generator-{seed}.png via anchor + object URL; revokes after the click', async () => {
      const order: string[] = [];
      const toBlobCanvases: HTMLCanvasElement[] = [];
      const clickedAnchors: HTMLAnchorElement[] = [];
      const blob = new Blob(['png-bytes'], { type: 'image/png' });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(function (this: HTMLAnchorElement) {
          order.push('click');
          clickedAnchors.push(this);
        });

      const h = boot('', undefined, {
        toBlob: async (canvas) => {
          toBlobCanvases.push(canvas);
          order.push('toBlob');
          return blob;
        },
        createObjectURL: (b) => {
          order.push('createObjectURL');
          expect(b).toBe(blob);
          return 'blob:fake-url';
        },
        revokeObjectURL: (url) => {
          order.push('revoke');
          expect(url).toBe('blob:fake-url');
        },
      });

      h.controller.setSeed(42); // seed at click time lands in the filename
      h.panel.elements.exportButton.click();
      await flushMicrotasks();

      expect(toBlobCanvases).toEqual([h.canvas]); // exports the live canvas
      expect(order).toEqual(['toBlob', 'createObjectURL', 'click', 'revoke']); // revoke AFTER click
      // Harden (P2-4): export settles the reveal first — skip() ran before
      // the capture (synchronously, ahead of the awaited toBlob).
      expect(h.animations[0]!.skipCount).toBe(1);
      const anchor = clickedAnchors[0];
      expect(anchor?.download).toBe('biome-generator-42.png');
      expect(anchor?.getAttribute('href')).toBe('blob:fake-url');
      expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('toBlob → null: silent no-op — no anchor click, no object URL, no crash', async () => {
      const order: string[] = [];
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {
          order.push('click');
        });
      const h = boot('', undefined, {
        toBlob: async () => {
          order.push('toBlob');
          return null;
        },
        createObjectURL: () => {
          order.push('createObjectURL');
          return 'blob:never';
        },
        revokeObjectURL: () => {
          order.push('revoke');
        },
      });

      h.panel.elements.exportButton.click();
      await flushMicrotasks();

      expect(order).toEqual(['toBlob']); // nothing further happened
      expect(clickSpy).not.toHaveBeenCalled();
      expect(document.querySelector('a[download]')).toBeNull();
    });
  });
});
