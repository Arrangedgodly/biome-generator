// @vitest-environment happy-dom
//
// DOM-logic tests for the T10 control panel. Fakes stand in for the T6
// controller port and the T8 animation port (call logs + manual emit); no
// worker, no canvas rendering — happy-dom supplies just enough DOM for
// createElement/dispatchEvent/click semantics.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildControlPanel, WORKER_FAILED_MESSAGE } from './control-panel.ts';
import type {
  ControlPanelHandle,
  ControlPanelPorts,
  PanelControllerEvent,
  PanelStage,
} from './control-panel.ts';
import { PRESETS } from '../presets/index.ts';
import type { PresetDefinition } from '../presets/index.ts';
// T16-fix (F1) integration test only — the panel module itself stays decoupled.
import { StagedAnimation } from '../render/animation.ts';
import type { AnimationRendererPort } from '../render/animation.ts';

type ControllerCall = { method: string; value?: number; commit?: boolean; preset?: PresetDefinition };

class FakeController {
  readonly calls: ControllerCall[] = [];
  private readonly listeners = new Set<(e: PanelControllerEvent) => void>();

  setElevation(v: number, opts?: { commit?: boolean }): void {
    this.calls.push({ method: 'setElevation', value: v, commit: opts?.commit });
  }

  commitElevation(): void {
    this.calls.push({ method: 'commitElevation' });
  }

  setMoisture(v: number): void {
    this.calls.push({ method: 'setMoisture', value: v });
  }

  setSeed(seed: number): void {
    this.calls.push({ method: 'setSeed', value: seed });
  }

  regenerate(seed?: number): void {
    this.calls.push({ method: 'regenerate', value: seed });
  }

  applyPreset(preset: PresetDefinition): void {
    this.calls.push({ method: 'applyPreset', preset });
    // Real-controller contract (map-controller.applyPreset): the sticky id
    // takes effect and a state echo lands on the preset's own sliders.
    this.activePreset = preset.id;
    this.emit({
      type: 'state',
      state: { seed: 0, elevation: preset.elevation, moisture: preset.moisture },
    });
  }

  /** Sticky preset id — the app's single truth (P1-2); tests flip it by hand. */
  activePreset: string | null = null;

  activePresetId(): string | null {
    return this.activePreset;
  }

  subscribe(fn: (e: PanelControllerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(e: PanelControllerEvent): void {
    for (const listener of [...this.listeners]) listener(e);
  }

  callsOf(method: string): ControllerCall[] {
    return this.calls.filter((c) => c.method === method);
  }
}

class FakeAnimation {
  playing = false;
  skipCount = 0;
  private readonly listeners = new Set<(s: PanelStage) => void>();

  skip(): void {
    this.skipCount += 1;
  }

  onStageChange(cb: (s: PanelStage) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  emitStage(s: PanelStage): void {
    for (const listener of [...this.listeners]) listener(s);
  }
}

interface Harness {
  panel: ControlPanelHandle;
  controller: FakeController;
  animation: FakeAnimation;
  container: HTMLElement;
  retryCount: () => number;
  shareCount: () => number;
  exportCount: () => number;
}

const containers: HTMLElement[] = [];

function build(overrides?: Partial<ControlPanelPorts>): Harness {
  const controller = new FakeController();
  const animation = new FakeAnimation();
  let retries = 0;
  let shares = 0;
  let exports = 0;
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const panel = buildControlPanel(container, {
    controller,
    animation,
    onRetry: () => {
      retries += 1;
    },
    onShare: () => {
      shares += 1;
    },
    onExport: () => {
      exports += 1;
    },
    randomSeed: () => 424242,
    ...overrides,
  });
  return {
    panel,
    controller,
    animation,
    container,
    retryCount: () => retries,
    shareCount: () => shares,
    exportCount: () => exports,
  };
}

function setAndDispatch(input: HTMLInputElement, value: string, type: 'input' | 'change'): void {
  input.value = value;
  input.dispatchEvent(new Event(type, { bubbles: true }));
}

afterEach(() => {
  for (const c of containers) c.remove();
  containers.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T10 control panel', () => {
  it('elevation slider: input drives setElevation (no commit); change commits without re-setting', () => {
    const { panel, controller } = build();
    setAndDispatch(panel.elements.elevationInput, '0.7', 'input');
    expect(controller.callsOf('setElevation')).toEqual([
      { method: 'setElevation', value: 0.7, commit: undefined },
    ]);

    setAndDispatch(panel.elements.elevationInput, '0.7', 'change');
    expect(controller.callsOf('commitElevation')).toHaveLength(1);
    expect(controller.callsOf('setElevation')).toHaveLength(1); // change must not re-fire
  });

  it('moisture slider input drives setMoisture', () => {
    const { panel, controller } = build();
    setAndDispatch(panel.elements.moistureInput, '0.8', 'input');
    expect(controller.callsOf('setMoisture')).toEqual([{ method: 'setMoisture', value: 0.8 }]);
  });

  it('dice button uses the injected rng and updates the seed display', () => {
    const { panel, controller } = build();
    panel.elements.diceButton.click();
    expect(controller.callsOf('setSeed')).toEqual([{ method: 'setSeed', value: 424242 }]);
    expect(panel.elements.seedInput.value).toBe('424242');
  });

  it('dice button falls back to the Math.random default (int 0..999999)', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    const { panel, controller } = build({ randomSeed: undefined });
    panel.elements.diceButton.click();
    expect(controller.callsOf('setSeed')).toEqual([{ method: 'setSeed', value: 999999 }]);
    expect(random).toHaveBeenCalled();
  });

  it('seed input: valid int commits via setSeed; invalid text is ignored, reverts, and shows the rule hint', () => {
    const { panel, controller } = build();
    const seed = panel.elements.seedInput;
    const hint = panel.elements.seedError;
    expect(hint.getAttribute('aria-live')).toBe('polite');
    expect(hint.hidden).toBe(true);
    expect(seed.getAttribute('autocomplete')).toBe('off');

    setAndDispatch(seed, '123', 'change');
    expect(controller.callsOf('setSeed')).toEqual([{ method: 'setSeed', value: 123 }]);
    expect(seed.value).toBe('123');

    // invalid on change → no call, display reverts to last valid, hint explains
    setAndDispatch(seed, 'abc', 'change');
    expect(controller.callsOf('setSeed')).toHaveLength(1);
    expect(seed.value).toBe('123');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('Seed must be a whole number between 0 and 999,999,999');
    expect(seed.getAttribute('aria-invalid')).toBe('true');

    // a valid commit clears the hint + aria-invalid
    setAndDispatch(seed, '7', 'change');
    expect(controller.callsOf('setSeed')).toHaveLength(2);
    expect(hint.hidden).toBe(true);
    expect(seed.hasAttribute('aria-invalid')).toBe(false);

    // invalid on blur (change never fired) → same revert + hint
    seed.value = 'xyz';
    seed.dispatchEvent(new Event('blur'));
    expect(controller.callsOf('setSeed')).toHaveLength(2);
    expect(seed.value).toBe('7');
    expect(hint.hidden).toBe(false);

    // 🎲 roll hides the hint too (a rolled seed is always valid)
    panel.elements.diceButton.click();
    expect(hint.hidden).toBe(true);
    const rolled = seed.value;

    // re-typing the same seed is a no-op (no duplicate regeneration)
    setAndDispatch(seed, rolled, 'change');
    expect(controller.callsOf('setSeed')).toHaveLength(3);
  });

  it('seed domain (hardening): decimals, negatives, over-max, empty, and scientific notation', () => {
    const { panel, controller } = build();
    const seed = panel.elements.seedInput;
    const hint = panel.elements.seedError;

    // '1e6' is a million (Number semantics), not parseInt's truncation to 1.
    setAndDispatch(seed, '1e6', 'change');
    expect(controller.callsOf('setSeed')).toEqual([{ method: 'setSeed', value: 1_000_000 }]);
    expect(seed.value).toBe('1000000');

    // '3.7' is honestly rejected instead of silently floored to 3.
    setAndDispatch(seed, '3.7', 'change');
    expect(controller.callsOf('setSeed')).toHaveLength(1);
    expect(seed.value).toBe('1000000');
    expect(hint.hidden).toBe(false);

    // Negative seeds render one map but serialize another — rejected outright.
    setAndDispatch(seed, '-5', 'change');
    expect(controller.callsOf('setSeed')).toHaveLength(1);
    expect(seed.value).toBe('1000000');
    expect(hint.hidden).toBe(false);

    // Past SEED_MAX (would clamp on the wire and break the shared URL).
    setAndDispatch(seed, '1000000000', 'change');
    expect(controller.callsOf('setSeed')).toHaveLength(1);
    expect(hint.hidden).toBe(false);

    // A 400-digit paste parses to Infinity — rejected, not committed.
    seed.value = '9'.repeat(400);
    seed.dispatchEvent(new Event('blur'));
    expect(controller.callsOf('setSeed')).toHaveLength(1);
    expect(seed.value).toBe('1000000');

    // Empty never forges seed 0.
    setAndDispatch(seed, '', 'change');
    expect(controller.callsOf('setSeed')).toHaveLength(1);
    expect(seed.value).toBe('1000000');

    // The domain boundary itself commits.
    setAndDispatch(seed, '999999999', 'change');
    expect(controller.callsOf('setSeed')).toEqual([
      { method: 'setSeed', value: 1_000_000 },
      { method: 'setSeed', value: 999_999_999 },
    ]);
    expect(hint.hidden).toBe(true);
  });

  it('Generate button calls regenerate() with no seed override', () => {
    const { panel, controller } = build();
    panel.elements.generateButton.click();
    expect(controller.callsOf('regenerate')).toEqual([{ method: 'regenerate', value: undefined }]);
  });

  it('Skip button: disabled when idle, enabled while playing, click skips; canvas click skips only during play', () => {
    const { panel, animation } = build();
    expect(panel.elements.skipButton.disabled).toBe(true);

    animation.playing = true;
    animation.emitStage('elevation'); // play() announces its first stage synchronously
    expect(panel.elements.skipButton.disabled).toBe(false);
    panel.elements.skipButton.click();
    expect(animation.skipCount).toBe(1);

    animation.playing = false;
    animation.emitStage('done');
    expect(panel.elements.skipButton.disabled).toBe(true);

    const canvas = document.createElement('canvas');
    panel.bindCanvasSkip(canvas);
    animation.playing = false;
    canvas.click();
    expect(animation.skipCount).toBe(1); // idle canvas click does nothing
    animation.playing = true;
    canvas.click();
    expect(animation.skipCount).toBe(2);
  });

  it('stage announcements update the aria-live label; done settles to "Map ready · seed N"', () => {
    const { panel, animation, controller } = build();
    const label = panel.elements.stageLabel;
    expect(label.getAttribute('aria-live')).toBe('polite');
    expect(label.textContent).toBe('');

    // lastSeed rides in on the state events (the settled line quotes it).
    controller.emit({ type: 'state', state: { seed: 128, elevation: 0.3, moisture: 0.5 } });

    animation.emitStage('elevation');
    expect(label.textContent).toBe('Stage: Elevation');
    animation.emitStage('moisture');
    expect(label.textContent).toBe('Stage: Moisture');
    animation.emitStage('biomes');
    expect(label.textContent).toBe('Stage: Biomes');
    animation.emitStage('done');
    expect(label.textContent).toBe('Map ready · seed 128'); // full text, no CSS prefix
  });

  it('stageHost option re-homes the stage label — map status lives with the map (layout pass)', () => {
    const controller = new FakeController();
    const animation = new FakeAnimation();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const host = document.createElement('div');
    const panel = buildControlPanel(
      container,
      {
        controller,
        animation,
        onRetry: () => {},
        onShare: () => {},
        onExport: () => {},
      },
      { stageHost: host },
    );

    expect(host.contains(panel.elements.stageLabel)).toBe(true);
    expect(container.contains(panel.elements.stageLabel)).toBe(false);

    animation.emitStage('elevation'); // hosted label still announces
    expect(panel.elements.stageLabel.textContent).toBe('Stage: Elevation');
    panel.destroy();
  });

  it('panel topology (layout pass): tune → presets → Generate → outputs, cluster starts on actions and outputs', () => {
    const { panel } = build();
    const rows = [...panel.root.children].filter((el) => el.classList.contains('control-row'));
    expect(rows).toHaveLength(6);

    const summary = rows.map((row) => ({
      cluster: row.classList.contains('cluster-start'),
      preset: row.querySelector('[data-preset]') !== null,
      generate: row.querySelector('#generate-button') !== null,
      outputs: row.querySelector('#export-button') !== null,
    }));
    // DOM order: two slider rows + seed row (tune), presets, Generate, outputs.
    expect(summary.map((s) => s.preset || s.generate || s.outputs)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    // Cluster starts: the actions block (presets) and the outputs block
    // breathe away from the cluster above; the Generate row does not.
    expect(summary[3].cluster).toBe(true);
    expect(summary[4].cluster).toBe(false);
    expect(summary[5].cluster).toBe(true);
  });

  // ---- T16-fix (F1) integration: the REAL StagedAnimation behind the real panel ----
  // The unit test above proves the panel's refresh logic on a fake that
  // reports playing === false at 'done'; this test pins the actual defect —
  // before the fix, StagedAnimation announced 'done' BEFORE settling, so the
  // panel's last refresh saw playing === true and Skip stayed enabled (dead
  // button) after both normal completion and a user skip.

  /** Manual frame queue + fake clock driving a real StagedAnimation (T8 harness shape). */
  function createRealAnimation(): {
    anim: StagedAnimation;
    step(ms: number): void;
    pendingFrames(): number;
  } {
    let clock = 0;
    let nextHandle = 1;
    const frames: Array<{ handle: number; cb: () => void }> = [];
    const renderer: AnimationRendererPort = {
      draw() { /* pixel output is not under test here */ },
      crossfade() { /* ditto */ },
    };
    const anim = new StagedAnimation(renderer, undefined, {
      requestFrame: (cb) => {
        const handle = nextHandle++;
        frames.push({ handle, cb });
        return handle;
      },
      cancelFrame: (handle) => {
        const index = frames.findIndex((f) => f.handle === handle);
        if (index >= 0) frames.splice(index, 1);
      },
      now: () => clock,
    });
    return {
      anim,
      step(ms: number) {
        clock += ms;
        for (const f of frames.splice(0)) f.cb();
      },
      pendingFrames: () => frames.length,
    };
  }

  it('T16-fix F1: real StagedAnimation × real panel — Skip enabled during playback, disabled after completion AND after skip', async () => {
    const driver = createRealAnimation();
    const controller = new FakeController();
    const container = document.createElement('div');
    document.body.append(container);
    containers.push(container);
    const panel = buildControlPanel(container, {
      controller,
      animation: {
        skip: () => driver.anim.skip(),
        onStageChange: (cb) => driver.anim.onStageChange(cb),
        get playing() {
          return driver.anim.playing;
        },
      },
      onRetry: () => {},
      onShare: () => {},
      onExport: () => {},
    });

    // Idle at build: skip disabled until something plays.
    expect(panel.elements.skipButton.disabled).toBe(true);

    // Normal completion path: enabled throughout playback…
    const first = driver.anim.play();
    expect(panel.elements.skipButton.disabled).toBe(false); // 'elevation' announced, playing
    driver.step(1100); // inside fade 1 → 'moisture' announced
    expect(panel.elements.skipButton.disabled).toBe(false);
    let guard = 0;
    while (driver.pendingFrames() > 0) {
      driver.step(100);
      guard += 1;
      if (guard > 200) throw new Error('animation did not finish');
    }
    // …and disabled once the animation completes ('done' arrives settled).
    expect(panel.elements.skipButton.disabled).toBe(true);
    await expect(first).resolves.toBe('done');

    // User-skip path: play again, skip mid-run → disabled at 'done'.
    const second = driver.anim.play();
    expect(panel.elements.skipButton.disabled).toBe(false);
    driver.anim.skip();
    expect(panel.elements.skipButton.disabled).toBe(true);
    await expect(second).resolves.toBe('done');

    panel.destroy();
  });

  it('error event shows the alert region and disables the panel (Retry stays live); fields event restores', () => {
    const { panel, controller, retryCount } = build();
    const { errorRegion, errorMessage, retryButton } = panel.elements;
    expect(errorRegion.hidden).toBe(true);
    expect(errorRegion.getAttribute('role')).toBe('alert');

    controller.emit({ type: 'error', error: new Error('boom') });
    expect(errorRegion.hidden).toBe(false);
    expect(errorMessage.textContent).toBe(WORKER_FAILED_MESSAGE);
    expect(panel.elements.elevationInput.disabled).toBe(true);
    expect(panel.elements.moistureInput.disabled).toBe(true);
    expect(panel.elements.seedInput.disabled).toBe(true);
    expect(panel.elements.diceButton.disabled).toBe(true);
    expect(panel.elements.generateButton.disabled).toBe(true);
    expect(panel.elements.skipButton.disabled).toBe(true);
    expect(retryButton.disabled).toBe(false);

    expect(retryCount()).toBe(0);
    retryButton.click();
    expect(retryCount()).toBe(1);

    controller.emit({ type: 'fields', fields: { resolution: 512 }, final: true });
    expect(errorRegion.hidden).toBe(true);
    expect(panel.elements.elevationInput.disabled).toBe(false);
    expect(panel.elements.generateButton.disabled).toBe(false);
    expect(panel.elements.diceButton.disabled).toBe(false);
  });

  it('error disable hands focus to Try again when the focused control goes dark (hardening)', () => {
    const { panel, controller } = build();
    const { seedInput, retryButton } = panel.elements;

    // Focus inside the doomed set → focus lands on the one live control.
    seedInput.focus();
    expect(document.activeElement).toBe(seedInput);
    controller.emit({ type: 'error', error: new Error('boom') });
    expect(document.activeElement).toBe(retryButton);

    // Recovery, then: focus OUTSIDE the panel is never stolen.
    controller.emit({ type: 'fields', fields: { resolution: 512 }, final: true });
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    controller.emit({ type: 'error', error: new Error('boom') });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('state events sync sliders/readouts/seed; a dragged slider ignores programmatic writes', () => {
    const { panel, controller } = build();
    const { elevationInput, elevationReadout, moistureInput, moistureReadout, seedInput } =
      panel.elements;

    controller.emit({ type: 'state', state: { seed: 7, elevation: 0.3, moisture: 0.9 } });
    expect(elevationInput.value).toBe('0.3');
    expect(moistureInput.value).toBe('0.9');
    expect(elevationReadout.textContent).toBe('0.30');
    expect(moistureReadout.textContent).toBe('0.90');
    expect(seedInput.value).toBe('7');

    // malformed state payload → ignored without crashing
    controller.emit({ type: 'state', state: 'garbage' });
    expect(elevationInput.value).toBe('0.3');

    // mid-drag: the dragged slider keeps the pointer's value, readout still tracks
    elevationInput.dispatchEvent(new Event('pointerdown'));
    controller.emit({ type: 'state', state: { seed: 7, elevation: 0.4, moisture: 0.9 } });
    expect(elevationInput.value).toBe('0.3');
    expect(elevationReadout.textContent).toBe('0.40');
    expect(moistureInput.value).toBe('0.9'); // other slider still synced

    elevationInput.dispatchEvent(new Event('pointerup'));
    controller.emit({ type: 'state', state: { seed: 7, elevation: 0.4, moisture: 0.9 } });
    expect(elevationInput.value).toBe('0.4');
  });

  it('presets are enabled (T12) with registry labels; export/share are enabled (T14) with actions; fallback hidden; labels are associated', () => {
    const { panel, container } = build();
    const {
      presetButtons,
      exportButton,
      shareButton,
      shareFallback,
      elevationInput,
      moistureInput,
      seedInput,
    } = panel.elements;

    expect(presetButtons.map((b) => b.dataset.preset)).toEqual([
      'archipelago',
      'continent',
      'highlands',
    ]);
    expect(presetButtons.map((b) => b.textContent)).toEqual([
      'Archipelago',
      'Continent',
      'Highlands',
    ]);
    // T12 wired the presets: enabled from build, no pressed state yet.
    for (const button of presetButtons) {
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('aria-pressed')).toBe('false');
    }

    // T14 wired share/export: enabled, data-action routing keys kept, and the
    // manual-copy fallback region starts hidden.
    expect(exportButton.disabled).toBe(false);
    expect(shareButton.disabled).toBe(false);
    expect(exportButton.dataset.action).toBe('export');
    expect(shareButton.dataset.action).toBe('share');
    expect(shareFallback.hidden).toBe(true);

    // a11y baseline: explicit label[for] wiring on every labeled control
    expect(container.querySelector('label[for="elevation-input"]')).not.toBeNull();
    expect(container.querySelector('label[for="moisture-input"]')).not.toBeNull();
    expect(container.querySelector('label[for="seed-input"]')).not.toBeNull();
    expect(elevationInput.type).toBe('range');
    expect(elevationInput.min).toBe('0');
    expect(elevationInput.max).toBe('1');
    expect(elevationInput.step).toBe('0.01');
    expect(moistureInput.type).toBe('range');
    expect(seedInput.getAttribute('inputmode')).toBe('numeric');
  });

  it('destroy removes listeners: later events cause no controller/animation/skip calls', () => {
    const { panel, controller, animation } = build();
    setAndDispatch(panel.elements.elevationInput, '0.6', 'input');
    expect(controller.callsOf('setElevation')).toHaveLength(1);

    panel.destroy();
    setAndDispatch(panel.elements.elevationInput, '0.9', 'input');
    setAndDispatch(panel.elements.elevationInput, '0.9', 'change');
    panel.elements.generateButton.click();
    panel.elements.diceButton.click();
    expect(controller.calls).toHaveLength(1);

    // controller/animation subscriptions dropped → no state sync, no label change
    controller.emit({ type: 'state', state: { seed: 5, elevation: 0.42, moisture: 0.5 } });
    expect(panel.elements.elevationInput.value).toBe('0.9'); // untouched by the handler
    animation.emitStage('moisture');
    expect(panel.elements.stageLabel.textContent).toBe('');

    // canvas skip listeners registered before or after destroy are all removed
    const canvas = document.createElement('canvas');
    panel.bindCanvasSkip(canvas);
    animation.playing = true;
    panel.destroy();
    canvas.click();
    expect(animation.skipCount).toBe(0);
  });

  describe('T12 preset wiring', () => {
    const archipelago = PRESETS[0];
    const highlands = PRESETS[2];

    it('clicking a preset button calls applyPreset with the full registry payload', () => {
      const { panel, controller } = build();
      // Native <button type="button"> — keyboard-operable by default.
      for (const button of panel.elements.presetButtons) {
        expect(button.tagName).toBe('BUTTON');
        expect(button.type).toBe('button');
      }

      panel.elements.presetButtons[0].click(); // archipelago
      expect(controller.callsOf('applyPreset')).toEqual([
        { method: 'applyPreset', preset: archipelago },
      ]);

      panel.elements.presetButtons[2].click(); // highlands
      expect(controller.callsOf('applyPreset')).toEqual([
        { method: 'applyPreset', preset: archipelago },
        { method: 'applyPreset', preset: highlands },
      ]);
    });

    it('marks the clicked preset aria-pressed and clears the others', () => {
      const { panel } = build();
      const [a, c, h] = panel.elements.presetButtons;

      a.click();
      expect(a.getAttribute('aria-pressed')).toBe('true');
      expect(c.getAttribute('aria-pressed')).toBe('false');
      expect(h.getAttribute('aria-pressed')).toBe('false');

      h.click();
      expect(a.getAttribute('aria-pressed')).toBe('false');
      expect(c.getAttribute('aria-pressed')).toBe('false');
      expect(h.getAttribute('aria-pressed')).toBe('true');
    });

    it('state events render pressed state from activePresetId() — sliders never decide (P1-2)', () => {
      const { panel, controller } = build();
      const [a, c, h] = panel.elements.presetButtons;
      a.click();
      expect(a.getAttribute('aria-pressed')).toBe('true');

      // Moisture nudged OFF the preset's sliders: the chip STAYS pressed —
      // the sticky id (and the share URL it feeds) still say archipelago.
      controller.emit({ type: 'state', state: { seed: 0, elevation: archipelago.elevation, moisture: 0.95 } });
      expect(a.getAttribute('aria-pressed')).toBe('true');

      // Upstream, an elevation input cleared the overrides and the app's id
      // went null → chip unpresses (custom terrain), in lockstep with the URL.
      controller.activePreset = null;
      controller.emit({ type: 'state', state: { seed: 0, elevation: 0.5, moisture: 0.55 } });
      expect(a.getAttribute('aria-pressed')).toBe('false');
      expect(c.getAttribute('aria-pressed')).toBe('false');
      expect(h.getAttribute('aria-pressed')).toBe('false');
    });

    it('slider coincidence never re-marks a chip — only the id does (P1-2)', () => {
      const { panel, controller } = build();
      const [a, c, h] = panel.elements.presetButtons;

      // Exact highlands slider positions with NO id (hand-edited hash that
      // lost its preset param): stays custom — the chip does not re-derive.
      controller.emit({
        type: 'state',
        state: { seed: 0, elevation: highlands.elevation, moisture: highlands.moisture },
      });
      expect(h.getAttribute('aria-pressed')).toBe('false');

      // The id wins regardless of slider positions.
      controller.activePreset = 'highlands';
      controller.emit({ type: 'state', state: { seed: 0, elevation: 0.11, moisture: 0.22 } });
      expect(h.getAttribute('aria-pressed')).toBe('true');
      expect(a.getAttribute('aria-pressed')).toBe('false');
      expect(c.getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('T14 share + export wiring', () => {
    it('Share/Export clicks route to ports.onShare/onExport (enabled, data-action kept)', () => {
      const { panel, shareCount, exportCount } = build();
      const { shareButton, exportButton } = panel.elements;
      expect(shareButton.disabled).toBe(false);
      expect(exportButton.disabled).toBe(false);
      expect(shareButton.dataset.action).toBe('share');
      expect(exportButton.dataset.action).toBe('export');

      shareButton.click();
      shareButton.click();
      exportButton.click();
      expect(shareCount()).toBe(2);
      expect(exportCount()).toBe(1);
    });

    it('flashShareSuccess: label + aria-live announce to "Link copied", revert after ~1.5s', () => {
      vi.useFakeTimers();
      const { panel, container } = build();
      const status = container.querySelector('#share-status');
      expect(status?.getAttribute('aria-live')).toBe('polite');

      panel.flashShareSuccess();
      expect(panel.elements.shareButton.textContent).toBe('Link copied');
      expect(status?.textContent).toBe('Link copied');

      vi.advanceTimersByTime(1499);
      expect(panel.elements.shareButton.textContent).toBe('Link copied'); // still flashing
      vi.advanceTimersByTime(1);
      expect(panel.elements.shareButton.textContent).toBe('Copy link');
      expect(status?.textContent).toBe(''); // announce cleared with the revert
    });

    it('a second flash resets the revert timer (no early revert from the first)', () => {
      vi.useFakeTimers();
      const { panel } = build();
      panel.flashShareSuccess();
      vi.advanceTimersByTime(1000);
      panel.flashShareSuccess(); // restart the window
      vi.advanceTimersByTime(1000); // 2000ms since flash #1 — must NOT have fired
      expect(panel.elements.shareButton.textContent).toBe('Link copied');
      vi.advanceTimersByTime(500);
      expect(panel.elements.shareButton.textContent).toBe('Copy link');
    });

    it('showShareFallbackUrl reveals a labeled read-only input with the URL; flash hides it again', () => {
      const { panel, container } = build();
      const region = panel.elements.shareFallback;
      expect(region.hidden).toBe(true);

      panel.showShareFallbackUrl('https://example.test/x#v=1&seed=0');
      expect(region.hidden).toBe(false);
      const input = region.querySelector<HTMLInputElement>('input');
      expect(input?.readOnly).toBe(true); // selectable, not editable
      expect(input?.value).toBe('https://example.test/x#v=1&seed=0');
      expect(container.querySelector('label[for="share-fallback-input"]')).not.toBeNull();

      vi.useFakeTimers();
      panel.flashShareSuccess(); // a real copy supersedes the manual affordance
      expect(region.hidden).toBe(true);
    });

    it('destroy clears the flash timer — the label never late-reverts', () => {
      vi.useFakeTimers();
      const { panel } = build();
      panel.flashShareSuccess();
      panel.destroy();
      vi.advanceTimersByTime(5000);
      expect(panel.elements.shareButton.textContent).toBe('Link copied'); // timer was cleared
    });
  });
});
