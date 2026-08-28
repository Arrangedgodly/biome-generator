/**
 * Control panel + error surface (plan T10; D5 error+retry, `docs/ultron/
 * research/rq5-safari-workers.md`).
 *
 * Pure DOM-builder over injected ports — no imports from the controller or
 * animation modules (the T12 preset registry is the one import: pure data the
 * buttons are built from), so the whole panel is testable against fakes in
 * happy-dom (`control-panel.test.ts`). All controls are native, labeled,
 * keyboard-operable elements (a11y baseline); nothing is built with
 * innerHTML.
 *
 * Wiring contract (T6/T8 semantics):
 * - elevation `input` → `controller.setElevation(v)` during drag;
 *   `change` → `controller.commitElevation()` (512² release regen).
 * - moisture `input` → `controller.setMoisture(v)` (instant local reclassify).
 * - Generate → `controller.regenerate()`; 🎲 → `setSeed(randomSeed())`;
 *   seed input → `setSeed(parseInt)` when the text is a valid integer
 *   (invalid text is ignored and the display reverts to the last valid seed).
 * - preset buttons (T12, enabled) → `controller.applyPreset(findPreset(id))`;
 *   the clicked button gets `aria-pressed="true"` (others false), and later
 *   `state` events re-evaluate it: matching a preset's slider positions at 2
 *   decimals re-marks that preset, anything else clears all pressed state
 *   (custom terrain).
 * - `animation.onStageChange` → aria-live stage label ('done' keeps 'Biomes',
 *   the final stage name — no timers, no auto-clear).
 * - Skip button (enabled only while `animation.playing`) and canvas-click
 *   (`bindCanvasSkip`) both call `animation.skip()`.
 * - Share/Export (T14, enabled): Share click → `ports.onShare` and Export
 *   click → `ports.onExport` — the APP owns the flush+copy / download logic
 *   (it holds the URL writer and the location). The panel only routes clicks
 *   and reports the outcome: `flashShareSuccess()` swaps the Share label to
 *   'Copied!' (+ aria-live announce) and reverts after ~1.5s (injectable
 *   `flashTimer`, cleared on destroy); `showShareFallbackUrl(url)` reveals a
 *   labeled read-only input carrying the URL for manual selection when every
 *   programmatic copy path failed.
 * - controller `{type:'error'}` → role="alert" region with a friendly message
 *   + Retry (`ports.onRetry` rebuilds the stack, app.ts); the panel is
 *   disabled meanwhile. `{type:'fields'}` hides the error and re-enables.
 * - `state` events sync slider positions/readouts/seed display; programmatic
 *   slider writes are suppressed while the user is actively dragging that
 *   slider (pointerdown→pointerup) so echoes never fight the pointer.
 */

import { PRESETS, findPreset } from '../presets/index.ts';
import type { PresetDefinition } from '../presets/index.ts';

/** Stage names as announced/displayed; 'done' shows the final stage name. */
const STAGE_TEXT: Record<PanelStage, string> = {
  elevation: 'Elevation',
  moisture: 'Moisture',
  biomes: 'Biomes',
  done: 'Biomes',
};

/** Friendly, non-technical error copy (town-hall: friendly error + retry). */
export const WORKER_FAILED_MESSAGE = 'Worker failed — retrying';

/** Share-button flash (T14): transient success copy + revert delay. */
export const SHARE_FLASH_TEXT = 'Copied!';
export const SHARE_FLASH_MS = 1500;

/**
 * Minimal timer port for the T14 share-flash revert — injected in tests,
 * defaults to `setTimeout`/`clearTimeout` (resolved lazily so fake timers
 * intercept).
 */
export interface PanelTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Default 🎲 range: uniform int 0..999_999. */
export function defaultRandomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export type PanelStage = 'elevation' | 'moisture' | 'biomes' | 'done';

/**
 * The controller-event slice the panel consumes. `MapController`'s
 * `ControllerEvent` union satisfies this shape structurally; the index
 * signature keeps the panel decoupled and forces callers to narrow unknowns.
 */
export type PanelControllerEvent = {
  type: 'fields' | 'preview' | 'error' | 'state';
  [key: string]: unknown;
};

export interface ControlPanelPorts {
  controller: {
    setElevation(v: number, opts?: { commit?: boolean }): void;
    commitElevation(): void;
    setMoisture(v: number): void;
    setSeed(seed: number): void;
    regenerate(seed?: number): void;
    /** T12 preset apply: structural payload — the controller batches sliders + overrides + ONE regen. */
    applyPreset(preset: PresetDefinition): void;
    subscribe(fn: (e: PanelControllerEvent) => void): () => void;
  };
  animation: {
    skip(): void;
    onStageChange(cb: (s: PanelStage) => void): () => void;
    readonly playing: boolean;
  };
  /** Injected retry: rebuild the whole stack (controller+animation) + regenerate. */
  onRetry(): void;
  /** T14 share click — the app flushes the URL writer, copies, reports back via the handle. */
  onShare(): void;
  /** T14 export click — the app turns the canvas into a PNG download. */
  onExport(): void;
  /** Injectable 🎲 source (default: uniform int 0..999_999). */
  randomSeed?: () => number;
  /** Injectable share-flash timer (default: setTimeout/clearTimeout). */
  flashTimer?: PanelTimer;
}

export interface ControlPanelElements {
  elevationInput: HTMLInputElement;
  elevationReadout: HTMLSpanElement;
  moistureInput: HTMLInputElement;
  moistureReadout: HTMLSpanElement;
  seedInput: HTMLInputElement;
  diceButton: HTMLButtonElement;
  generateButton: HTMLButtonElement;
  skipButton: HTMLButtonElement;
  presetButtons: HTMLButtonElement[];
  exportButton: HTMLButtonElement;
  shareButton: HTMLButtonElement;
  /** T14 manual-copy fallback region (hidden until every copy path failed). */
  shareFallback: HTMLElement;
  stageLabel: HTMLElement;
  errorRegion: HTMLElement;
  errorMessage: HTMLSpanElement;
  retryButton: HTMLButtonElement;
}

export interface ControlPanelHandle {
  readonly root: HTMLElement;
  /** Master enable/disable (error state disables everything except Retry). */
  setEnabled(enabled: boolean): void;
  /** Direct stage-label write (aria-live), exposed for tests/T11. */
  setStageLabel(text: string): void;
  showError(message: string): void;
  hideError(): void;
  /** Wire canvas-click → skip, but only while the animation is playing. */
  bindCanvasSkip(canvas: HTMLCanvasElement): void;
  /**
   * T14 share success feedback: Share label → 'Copied!' (+ aria-live announce),
   * hides any shown fallback, reverts after `SHARE_FLASH_MS` via the (injectable)
   * flash timer. Calling again resets the revert timer.
   */
  flashShareSuccess(): void;
  /**
   * T14 last-resort copy affordance: reveal a labeled read-only input carrying
   * `url` (visible, focusable, pre-selected) so the user can copy it manually.
   */
  showShareFallbackUrl(url: string): void;
  /** Remove every listener this panel registered (panel DOM stays). */
  destroy(): void;
  readonly elements: ControlPanelElements;
}

/** `state` payload guard — narrows the index-signature unknown to numbers. */
function isControlState(v: unknown): v is { seed: number; elevation: number; moisture: number } {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.seed === 'number' && typeof s.elevation === 'number' && typeof s.moisture === 'number'
  );
}

export function buildControlPanel(
  container: HTMLElement,
  ports: ControlPanelPorts,
): ControlPanelHandle {
  const randomSeed = ports.randomSeed ?? defaultRandomSeed;
  // Lazy setTimeout/clearTimeout references so vi.useFakeTimers can intercept.
  const flashTimer: PanelTimer =
    ports.flashTimer ?? {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    };

  // ---- listener bookkeeping (for destroy()) --------------------------------
  const disposers: Array<() => void> = [];
  function listen(target: HTMLElement, type: string, fn: (event: Event) => void): void {
    target.addEventListener(type, fn);
    disposers.push(() => target.removeEventListener(type, fn));
  }

  // ---- DOM (all createElement, no innerHTML) -------------------------------
  const root = document.createElement('div');
  root.className = 'control-panel';

  const elevationSlider = makeSlider('elevation-input', 'Elevation');
  const moistureSlider = makeSlider('moisture-input', 'Moisture');
  const elevationReadout = makeReadout('0.50');
  const moistureReadout = makeReadout('0.50');

  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.id = 'seed-input';
  seedInput.inputMode = 'numeric';
  seedInput.value = '0';
  const seedLabel = makeLabel('seed-input', 'Seed');
  const diceButton = document.createElement('button');
  diceButton.type = 'button';
  diceButton.id = 'dice-button';
  diceButton.className = 'dice';
  diceButton.textContent = '🎲';
  diceButton.setAttribute('aria-label', 'Randomize seed');

  const generateButton = makeActionButton('generate-button', 'Generate');
  const skipButton = makeActionButton('skip-button', 'Skip');

  // Built straight from the T12 registry so UI and data can never drift.
  const presetButtons: HTMLButtonElement[] = PRESETS.map((preset) => {
    const button = makeActionButton(`preset-${preset.id}`, preset.name);
    button.dataset.preset = preset.id;
    button.setAttribute('aria-pressed', 'false'); // T12 toggle state
    return button;
  });

  const exportButton = makeActionButton('export-button', 'Export');
  exportButton.dataset.action = 'export';
  const shareButton = makeActionButton('share-button', 'Share');
  shareButton.dataset.action = 'share';

  // T14 share outcome surfaces: a visually-hidden aria-live announcer (the
  // 'Copied!' flash must be heard, not just seen) and the manual-copy
  // fallback — a labeled read-only input that only appears when both copy
  // paths failed.
  const shareStatus = document.createElement('span');
  shareStatus.id = 'share-status';
  shareStatus.setAttribute('aria-live', 'polite');
  shareStatus.style.position = 'absolute';
  shareStatus.style.width = '1px';
  shareStatus.style.height = '1px';
  shareStatus.style.overflow = 'hidden';
  shareStatus.style.clipPath = 'inset(50%)';
  shareStatus.textContent = '';

  const shareFallbackInput = document.createElement('input');
  shareFallbackInput.type = 'text';
  shareFallbackInput.id = 'share-fallback-input';
  shareFallbackInput.readOnly = true; // selectable, not editable
  const shareFallback = document.createElement('div');
  shareFallback.id = 'share-fallback';
  shareFallback.className = 'share-fallback';
  shareFallback.hidden = true;
  shareFallback.append(makeLabel('share-fallback-input', 'Share this link'), shareFallbackInput);

  const stageLabel = document.createElement('p');
  stageLabel.id = 'stage-label';
  stageLabel.className = 'stage-label';
  stageLabel.setAttribute('aria-live', 'polite');
  stageLabel.textContent = '';

  const errorMessage = document.createElement('span');
  errorMessage.id = 'error-message';
  const retryButton = makeActionButton('retry-button', 'Retry');
  const errorRegion = document.createElement('div');
  errorRegion.id = 'error-region';
  errorRegion.className = 'error-region';
  errorRegion.setAttribute('role', 'alert');
  errorRegion.hidden = true;
  errorRegion.append(errorMessage, retryButton);

  root.append(
    row(elevationSlider.label, elevationSlider.input, elevationReadout),
    row(moistureSlider.label, moistureSlider.input, moistureReadout),
    row(seedLabel, seedInput, diceButton),
    row(generateButton, skipButton),
    row(...presetButtons),
    row(exportButton, shareButton, shareStatus),
    shareFallback,
    stageLabel,
    errorRegion,
  );
  container.append(root);

  // Flatten the slider helpers' {input,label} bundles to the elements object.
  const elements: ControlPanelElements = {
    elevationInput: elevationSlider.input,
    elevationReadout,
    moistureInput: moistureSlider.input,
    moistureReadout,
    seedInput,
    diceButton,
    generateButton,
    skipButton,
    presetButtons,
    exportButton,
    shareButton,
    shareFallback,
    stageLabel,
    errorRegion,
    errorMessage,
    retryButton,
  };

  // ---- state ---------------------------------------------------------------
  let masterEnabled = true;
  let lastSeed = 0; // last valid seed shown/committed (revert target)
  let draggingElevation = false;
  let draggingMoisture = false;

  // Everything that goes dark in the error state (Retry stays clickable).
  const disableTargets: Array<HTMLInputElement | HTMLButtonElement> = [
    elements.elevationInput,
    elements.moistureInput,
    seedInput,
    diceButton,
    generateButton,
    ...presetButtons,
    exportButton,
    shareButton,
  ];

  function refreshSkipButton(): void {
    skipButton.disabled = !(masterEnabled && ports.animation.playing);
  }

  function setStageLabel(text: string): void {
    stageLabel.textContent = text;
  }

  function setEnabled(enabled: boolean): void {
    masterEnabled = enabled;
    for (const target of disableTargets) target.disabled = !enabled;
    refreshSkipButton(); // skip follows master × playing; retry never disables
  }

  function showError(message: string): void {
    errorMessage.textContent = message;
    errorRegion.hidden = false;
    setEnabled(false);
  }

  function hideError(): void {
    errorRegion.hidden = true;
    setEnabled(true);
  }

  // ---- T14 share outcome surfaces -------------------------------------------
  let flashHandle: unknown = null;

  function hideShareFallback(): void {
    shareFallback.hidden = true;
  }

  function showShareFallbackUrl(url: string): void {
    shareFallbackInput.value = url;
    shareFallback.hidden = false;
    shareFallbackInput.select(); // pre-selected: ⌘C / Ctrl+C works immediately
  }

  function flashShareSuccess(): void {
    hideShareFallback(); // a real copy supersedes the manual affordance
    if (flashHandle !== null) flashTimer.clear(flashHandle);
    shareButton.textContent = SHARE_FLASH_TEXT;
    shareStatus.textContent = SHARE_FLASH_TEXT; // aria-live announce
    flashHandle = flashTimer.set(() => {
      flashHandle = null;
      shareButton.textContent = 'Share';
      shareStatus.textContent = '';
    }, SHARE_FLASH_MS);
  }

  // ---- preset toggle state (T12) ---------------------------------------------
  /** Mark one preset button pressed (aria-pressed), or none when id is null. */
  function setPressedPreset(id: string | null): void {
    for (const button of presetButtons) {
      button.setAttribute('aria-pressed', button.dataset.preset === id ? 'true' : 'false');
    }
  }

  /** 2-decimal slider comparison — the resolution the URL wire carries (T13). */
  function matchesPresetSliders(
    preset: PresetDefinition,
    elevation: number,
    moisture: number,
  ): boolean {
    return (
      elevation.toFixed(2) === preset.elevation.toFixed(2) &&
      moisture.toFixed(2) === preset.moisture.toFixed(2)
    );
  }

  /**
   * Re-derive the pressed preset from a state event: exact (2-dec) slider
   * match on one of the registry presets re-marks it pressed; any manual
   * deviation from the active preset clears all pressed state (custom).
   */
  function syncPressedPreset(elevation: number, moisture: number): void {
    const match = PRESETS.find((p) => matchesPresetSliders(p, elevation, moisture));
    setPressedPreset(match?.id ?? null);
  }

  // ---- controller events ----------------------------------------------------
  function syncState(e: PanelControllerEvent): void {
    if (e.type !== 'state') return;
    if (!isControlState(e.state)) return;
    lastSeed = e.state.seed;
    if (!draggingElevation) elements.elevationInput.value = String(e.state.elevation);
    if (!draggingMoisture) elements.moistureInput.value = String(e.state.moisture);
    elevationReadout.textContent = e.state.elevation.toFixed(2);
    moistureReadout.textContent = e.state.moisture.toFixed(2);
    if (document.activeElement !== seedInput) seedInput.value = String(e.state.seed);
    syncPressedPreset(e.state.elevation, e.state.moisture);
  }

  const onControllerEvent = (e: PanelControllerEvent): void => {
    if (e.type === 'state') {
      syncState(e);
      return;
    }
    if (e.type === 'error') {
      showError(WORKER_FAILED_MESSAGE);
      return;
    }
    if (e.type === 'fields') {
      hideError();
      return;
    }
    // 'preview' is an in-progress worker success — no panel reaction.
  };

  // ---- animation stages -----------------------------------------------------
  const onStage = (stage: PanelStage): void => {
    setStageLabel(STAGE_TEXT[stage]);
    refreshSkipButton();
  };

  // ---- control listeners ----------------------------------------------------
  listen(elements.elevationInput, 'input', () => {
    const v = parseFloatValue(elements.elevationInput.value);
    if (v !== null) ports.controller.setElevation(v);
  });
  listen(elements.elevationInput, 'change', () => {
    ports.controller.commitElevation();
  });
  listen(elements.elevationInput, 'pointerdown', () => {
    draggingElevation = true;
  });
  listen(elements.elevationInput, 'pointerup', () => {
    draggingElevation = false;
  });

  listen(elements.moistureInput, 'input', () => {
    const v = parseFloatValue(elements.moistureInput.value);
    if (v !== null) ports.controller.setMoisture(v);
  });
  listen(elements.moistureInput, 'pointerdown', () => {
    draggingMoisture = true;
  });
  listen(elements.moistureInput, 'pointerup', () => {
    draggingMoisture = false;
  });

  const commitSeed = (): void => {
    const parsed = Number.parseInt(seedInput.value.trim(), 10);
    if (Number.isNaN(parsed)) {
      seedInput.value = String(lastSeed); // invalid → ignore + revert display
      return;
    }
    if (parsed === lastSeed) {
      seedInput.value = String(parsed);
      return;
    }
    lastSeed = parsed;
    seedInput.value = String(parsed);
    ports.controller.setSeed(parsed);
  };
  listen(seedInput, 'change', commitSeed);
  listen(seedInput, 'blur', commitSeed); // safety net when change never fired

  listen(diceButton, 'click', () => {
    const seed = randomSeed();
    lastSeed = seed;
    seedInput.value = String(seed);
    ports.controller.setSeed(seed);
  });

  listen(generateButton, 'click', () => {
    ports.controller.regenerate();
  });

  // T12: preset apply is ONE batch — the port forwards the full snapshot to
  // the controller (sliders + overrides + a single Generate-class regen).
  for (const button of presetButtons) {
    listen(button, 'click', () => {
      const preset = findPreset(button.dataset.preset ?? null);
      if (preset === null) return; // buttons are built from the registry — unreachable
      ports.controller.applyPreset(preset);
      setPressedPreset(preset.id);
    });
  }

  listen(skipButton, 'click', () => {
    if (ports.animation.playing) ports.animation.skip();
  });

  // T14: click routing only — the app owns flush+copy (share) / download (export).
  listen(shareButton, 'click', () => {
    ports.onShare();
  });
  listen(exportButton, 'click', () => {
    ports.onExport();
  });

  listen(retryButton, 'click', () => {
    ports.onRetry();
  });

  const unsubscribeController = ports.controller.subscribe(onControllerEvent);
  const unsubscribeStages = ports.animation.onStageChange(onStage);

  refreshSkipButton(); // idle at build: skip disabled until something plays

  return {
    root,
    setEnabled,
    setStageLabel,
    showError,
    hideError,
    bindCanvasSkip(canvas: HTMLCanvasElement): void {
      listen(canvas, 'click', () => {
        if (ports.animation.playing) ports.animation.skip();
      });
    },
    flashShareSuccess,
    showShareFallbackUrl,
    destroy(): void {
      if (flashHandle !== null) flashTimer.clear(flashHandle);
      flashHandle = null;
      unsubscribeController();
      unsubscribeStages();
      for (const dispose of disposers) dispose();
      disposers.length = 0;
    },
    elements,
  };

  // ---- local DOM helpers (closures over `document`) --------------------------
  function makeLabel(forId: string, text: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.htmlFor = forId;
    label.textContent = text;
    return label;
  }

  function makeSlider(id: string, name: string): {
    input: HTMLInputElement;
    label: HTMLLabelElement;
  } {
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = '0';
    input.max = '1';
    input.step = '0.01';
    input.value = '0.5';
    return { input, label: makeLabel(id, name) };
  }

  function makeReadout(text: string): HTMLSpanElement {
    const readout = document.createElement('span');
    readout.className = 'readout';
    readout.textContent = text;
    return readout;
  }

  function makeActionButton(id: string, text: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.textContent = text;
    return button;
  }

  function row(...children: HTMLElement[]): HTMLElement {
    const r = document.createElement('div');
    r.className = 'control-row';
    r.append(...children);
    return r;
  }
}

function parseFloatValue(raw: string): number | null {
  const v = Number.parseFloat(raw);
  return Number.isNaN(v) ? null : v;
}
