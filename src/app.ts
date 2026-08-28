/**
 * Production app wiring (plan T10 + T11): builds and owns the full runtime
 * stack — worker-backed controller + renderer + staged animation + control
 * panel — and implements the D5 retry path (tear down and recreate the whole
 * stack around a fresh worker, never reuse a dead one).
 *
 * The panel is built ONCE; its ports are stable forwarding shims over the
 * current stack, so `rebuild()` can swap controller+animation underneath it
 * without the panel (or its subscriptions) ever going stale: controller events
 * and stage changes are re-broadcast through listener sets that survive
 * rebuilds.
 *
 * T11 first-load experience (this file's main surface):
 * - Boot (once, at construction): a stateful URL restores seed/sliders/preset
 *   through `controller.applySharedState` (one batch, one generate — the
 *   restored map is identical to the sharer's because the same params reach
 *   the worker); a bare URL boots the canonical 'continent' preset's OWN
 *   snapshot — deterministic seed 0 plus the preset's calibrated slider
 *   positions (T3c-fix; see `bareBootState`) — so first load is exactly the
 *   state a Continent preset click produces (same URL → identical map).
 *   Either way the resulting state is written back to the URL hash.
 * - Animation routing: every Generate-class `fields` arrival (cause
 *   'generate': boot, Generate button, 🎲, preset click) plays the staged
 *   animation; elevation-commit arrivals stay instant (controller already
 *   drew). Reduced motion is the animation env's business — `play()` is still
 *   called so the aria-live announcements fire.
 * - URL write-back: a coalescing writer (`createUrlStateWriter`) keeps the
 *   hash current on every state event (seed/slider/preset changes).
 * - Sticky preset id: set on preset click / restored boot; cleared ONLY when
 *   the controller's terrain overrides are gone (`hasOverrides === false`,
 *   i.e. an elevation drag/commit) — never re-derived from slider coincidence,
 *   never cleared by moisture tweaks. This makes shared URLs faithful in both
 *   T12-flagged corners: preset→elevation-drag→drag-back shares pure slider
 *   params (id stays off); preset→moisture-tweak shares the id (overrides
 *   re-applied on load).
 *
 * Everything effectful is injectable (`StartAppOptions`) so the whole flow is
 * testable against fakes in happy-dom (`app.test.ts`); the defaults keep the
 * real worker/renderer/location wiring.
 *
 * T14 share + export (this file owns both effects — the panel only routes
 * clicks and renders the outcome):
 * - Share: flush the coalescing writer FIRST (a just-changed slider is up to
 *   200 ms stale in the hash otherwise), build the absolute URL (adapter
 *   `href` base — origin + pathname — plus the canonical serialized state),
 *   then copy via `navigator.clipboard.writeText`; if that is unavailable or
 *   rejects, a temporary off-screen textarea + `document.execCommand('copy')`;
 *   if that also fails, `panel.showShareFallbackUrl(url)` reveals selectable
 *   text. Success in either programmatic path → `panel.flashShareSuccess()`.
 * - Export: `canvas.toBlob` → object URL → `<a download="biome-generator-
 *   {seed}.png">` click → revoke. A null blob is a silent no-op.
 */
import { createMapController } from './controller/create.ts';
import type { ControlState } from './controller/map-controller.ts';
import { StagedAnimation } from './render/animation.ts';
import type { AnimationEnv, AnimationRendererPort, AnimationStage } from './render/animation.ts';
import { buildControlPanel } from './ui/control-panel.ts';
import type { ControlPanelHandle, ControlPanelPorts, PanelControllerEvent } from './ui/control-panel.ts';
import { attachCanvasProbe } from './ui/canvas-probe.ts';
import { populateBiomeLegend } from './ui/biome-legend.ts';
import type { PresetDefinition } from './presets/index.ts';
import { findPreset } from './presets/index.ts';
import type { ClassifyBiases } from './generation/index.ts';
import {
  createUrlStateWriter,
  DEFAULT_SHARED_STATE,
  readStateFromLocation,
  serializeState,
  STATE_VERSION,
} from './state/urlState.ts';
import type { LocationPort, SharedState, UrlStateWriterOptions } from './state/urlState.ts';

/**
 * The canonical first-visit look (town-hall: "default preset auto-generates").
 * Bare URLs boot this preset with the deterministic default seed 0 — first
 * visits are stable and the bare URL round-trips identically.
 */
export const DEFAULT_BOOT_PRESET = 'continent' as const;

/**
 * The state a BARE URL boots with (T3c-fix): the boot preset's OWN snapshot —
 * default seed 0 plus the preset's calibrated slider positions and its id.
 * Before T3c-fix the bare path kept `DEFAULT_SHARED_STATE`'s centered 0.5/0.5
 * sliders and only layered the preset's field-param overrides on top, so the
 * first-load map was an uncalibrated hybrid (elevation 0.5 → redistribution
 * 1.5 instead of the preset's 0.3 → 1.38) that marginally inverted
 * snow/mountain and missed the coherence floor at the fixed boot seed. A bare
 * boot must produce exactly the same state as clicking the Continent preset:
 * `applySharedState` installs the preset's overrides (the sticky id survives —
 * booting at the preset's own positions is not a manual terrain input), and
 * the write-back pins `el`/`mo`/`preset` in the hash so a reload of that URL
 * regenerates the identical map. Falls back to the centered defaults only if
 * the boot preset id ever leaves the registry (not the case today).
 */
export function bareBootState(): SharedState {
  const preset = findPreset(DEFAULT_BOOT_PRESET);
  if (preset === null) {
    return { ...DEFAULT_SHARED_STATE, preset: null };
  }
  return {
    version: STATE_VERSION,
    seed: DEFAULT_SHARED_STATE.seed,
    elevation: preset.elevation,
    moisture: preset.moisture,
    preset: preset.id,
  };
}

/**
 * The controller slice `startApp` drives. `MapController` satisfies this
 * structurally; test fakes implement it directly (the class itself is nominal
 * because of its private state).
 */
export interface AppControllerPort {
  readonly state: ControlState;
  /** T11 sticky-preset signal: true while preset field-param overrides are live. */
  readonly hasOverrides: boolean;
  /** Live classification biases (moisture slider) — the probe reads these. */
  readonly biases: ClassifyBiases;
  setElevation(v: number, opts?: { commit?: boolean }): void;
  commitElevation(): void;
  setMoisture(v: number): void;
  setSeed(seed: number): void;
  regenerate(seed?: number): void;
  /** T12 preset apply: sliders + overrides + ONE Generate-class regen. */
  applyPreset(preset: PresetDefinition): void;
  /**
   * T11 batch boot/restore: seed + sliders + preset overrides (iff the id
   * resolves) + ONE Generate-class regen; emits exactly one state event.
   */
  applySharedState(s: {
    seed: number;
    elevation: number;
    moisture: number;
    presetId: string | null;
  }): void;
  setAnimationCancel(hook: () => boolean): void;
  subscribe(fn: (e: PanelControllerEvent) => void): () => void;
  dispose(): void;
}

/** The animation slice `startApp` drives (`StagedAnimation` satisfies it). */
export interface AppAnimationPort {
  play(): Promise<AnimationStage>;
  skip(): void;
  dispose(): void;
  onStageChange(cb: (s: AnimationStage) => void): () => void;
  readonly playing: boolean;
}

/**
 * The renderer slice the Surveyor's Probe reads (`MapRenderer` satisfies it):
 * live field samples at the CURRENT resolution plus that resolution, so the
 * probe always describes what is on screen (512² finals, 256² drag previews).
 */
export interface ProbeRendererPort {
  sample(fx: number, fy: number): { elevation: number; moisture: number } | undefined;
  readonly fieldResolution: number;
}

/** One controller+renderer stack (what the injectable bundle factory returns). */
export interface AppBundle {
  controller: AppControllerPort;
  /** Animation surface AND probe read surface (`MapRenderer` satisfies both). */
  renderer: AnimationRendererPort & ProbeRendererPort;
}

// ---- T14 injectable effects (all optional, all with real defaults) -----------

/** Clipboard write; resolves `false` when unavailable/rejected (never throws). */
export type ClipboardWrite = (text: string) => Promise<boolean>;
/** `document.execCommand` double (legacy copy fallback). */
export type ExecCommandFn = (command: string) => boolean;
/** Canvas → PNG blob (`null` = no bitmap available). */
export type CanvasToBlob = (canvas: HTMLCanvasElement) => Promise<Blob | null>;
/** Blob → object URL for the download anchor. */
export type CreateObjectURLFn = (blob: Blob) => string;
/** Release an object URL after the download click. */
export type RevokeObjectURLFn = (url: string) => void;
/** Builds the absolute URL the Share button copies. */
export type GetShareUrl = () => string;

/** Injection points for tests; every field defaults to the real wiring. */
export interface StartAppOptions {
  /** Stack factory (default: real worker client + DOM renderer). Called per build/rebuild. */
  createBundle?: () => AppBundle;
  /** Animation factory (default: real `StagedAnimation` over the bundle's renderer). */
  createAnimation?: (renderer: AnimationRendererPort, env: AnimationEnv) => AppAnimationPort;
  /** Partial animation env merged over the matchMedia-derived default. */
  animationEnv?: AnimationEnv;
  /** Location port for URL read/write (default: adapter over `location` + `history.replaceState`). */
  loc?: LocationPort;
  /** Writer scheduler/delay injection (see `createUrlStateWriter`). */
  writerOptions?: UrlStateWriterOptions;
  /** T14 share: clipboard writer (default: feature-detected `navigator.clipboard.writeText`, failures → false). */
  clipboard?: ClipboardWrite;
  /** T14 share fallback: `execCommand` (default: feature-detected `document.execCommand`). */
  execCommand?: ExecCommandFn;
  /** T14 export: canvas → PNG blob (default: `canvas.toBlob('image/png')` wrapped in a Promise). */
  toBlob?: CanvasToBlob;
  /** T14 export: blob → object URL (default: `URL.createObjectURL`). */
  createObjectURL?: CreateObjectURLFn;
  /** T14 export: release the object URL after the download click (default: `URL.revokeObjectURL`). */
  revokeObjectURL?: RevokeObjectURLFn;
  /**
   * T14 share: absolute-URL builder. Default: the location adapter's base
   * (its `href` without the hash, or origin+pathname) + `#` + the canonical
   * serialized CURRENT state (post-flush, so it is never stale).
   */
  getShareUrl?: GetShareUrl;
}

export interface AppHandle {
  readonly panel: ControlPanelHandle;
  /**
   * Tear down and recreate the controller+animation stack (fresh worker), then
   * re-apply the last known shared state (seed + sliders + preset) via
   * `applySharedState` — the D5 retry path and manual rebuild both land here.
   */
  rebuild(): void;
  /**
   * STICKY active preset id for URL/share state (T11): set on preset click or
   * restored boot; cleared only when terrain overrides are cleared (elevation
   * drag/commit). Never re-derived from slider positions.
   */
  getActivePreset(): string | null;
  /** Full teardown: flush the pending URL write, drop the panel, dispose the stack. */
  dispose(): void;
}

interface Stack {
  controller: AppControllerPort;
  animation: AppAnimationPort;
  /** The bundle's renderer — the probe reads live fields through it. */
  renderer: ProbeRendererPort;
}

function readPrefersReducedMotion(): boolean {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

/**
 * The app-side location adapter: `LocationPort` plus `href` — the absolute
 * page URL (origin + pathname + live hash) the T14 share button builds from.
 * (`LocationPort` itself stays minimal in urlState.ts; only the DEFAULT
 * adapter is extended — injected fake locs keep the narrow shape.)
 */
export type AppLocationAdapter = LocationPort & { readonly href: string };

function createBrowserLocationPort(): AppLocationAdapter {
  const loc = globalThis.location;
  if (loc === undefined || loc === null) {
    throw new Error('startApp: no global location available — pass opts.loc');
  }
  return {
    get hash(): string {
      return loc.hash;
    },
    replaceState(url: string): void {
      globalThis.history?.replaceState(globalThis.history.state, '', url);
    },
    /** Absolute page URL: origin + pathname + current hash (T14 share base). */
    get href(): string {
      return `${loc.origin}${loc.pathname}${loc.hash}`;
    },
  };
}

/**
 * Share-URL base: the adapter's `href` minus any hash when the adapter
 * carries one (the default browser adapter), else origin+pathname of the
 * global location (injected fake locs have no `href`), else ''.
 */
function readShareBase(loc: LocationPort): string {
  const href = (loc as { readonly href?: unknown }).href;
  if (typeof href === 'string' && href !== '') {
    const withoutHash = href.split('#')[0];
    return withoutHash === '' ? href : withoutHash;
  }
  const globalLoc = globalThis.location;
  if (globalLoc !== undefined && globalLoc !== null) {
    return `${globalLoc.origin}${globalLoc.pathname}`;
  }
  return '';
}

/** Clipboard API path — feature-detected, failures resolve false (never reject). */
function defaultClipboardWrite(text: string): Promise<boolean> {
  const clipboard: Clipboard | undefined = globalThis.navigator?.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return Promise.resolve(false);
  }
  return clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

/** Feature-detected `document.execCommand` (undefined in some DOM impls). */
function defaultExecCommand(command: string): boolean {
  const doc = globalThis.document;
  if (doc === undefined || typeof doc.execCommand !== 'function') return false;
  try {
    return doc.execCommand(command);
  } catch {
    return false;
  }
}

/**
 * Legacy copy path (T14 fallback): temporary off-screen read-only textarea,
 * `select()` + `execCommand('copy')`, always removed again. Returns whether
 * the command reported success.
 */
function legacyCopyViaTextarea(url: string, execCommand: ExecCommandFn): boolean {
  const doc = globalThis.document;
  if (doc === undefined) return false;
  const textarea = doc.createElement('textarea');
  textarea.value = url;
  textarea.readOnly = true; // selectable without opening mobile keyboards
  textarea.setAttribute('aria-label', 'Copy this link');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  doc.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = execCommand('copy');
  } catch {
    copied = false;
  } finally {
    textarea.remove();
  }
  return copied;
}

/** `canvas.toBlob` wrapped in a Promise (callback-based API). */
function defaultCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

function requireControlsContainer(): HTMLElement {
  const container = document.querySelector<HTMLElement>('#controls');
  if (container === null) throw new Error('#controls container not found');
  return container;
}

export function startApp(
  canvas: HTMLCanvasElement,
  container?: HTMLElement,
  opts: StartAppOptions = {},
): AppHandle {
  const controls = container ?? requireControlsContainer();
  const animationEnv: AnimationEnv = {
    prefersReducedMotion: readPrefersReducedMotion(),
    ...opts.animationEnv,
  };
  const loc = opts.loc ?? createBrowserLocationPort();
  const writer = createUrlStateWriter(loc, opts.writerOptions);
  const createBundle = opts.createBundle ?? (() => createMapController(canvas));
  const createAnimation =
    opts.createAnimation ?? ((renderer, env) => new StagedAnimation(renderer, undefined, env));

  // T14 effect injectables (defaults keep the real browser wiring).
  const clipboardWrite: ClipboardWrite = opts.clipboard ?? defaultClipboardWrite;
  const execCommand: ExecCommandFn = opts.execCommand ?? defaultExecCommand;
  const toBlob: CanvasToBlob = opts.toBlob ?? defaultCanvasToBlob;
  const createObjectURL: CreateObjectURLFn =
    opts.createObjectURL ?? ((blob) => URL.createObjectURL(blob));
  const revokeObjectURL: RevokeObjectURLFn =
    opts.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url));

  // Panel-facing listener sets — stable across stack rebuilds. The app-level
  // listener below is registered FIRST so URL write-back sees the sticky preset
  // id settle before anything else reacts.
  const eventListeners = new Set<(e: PanelControllerEvent) => void>();
  const stageListeners = new Set<(s: AnimationStage) => void>();

  // T11 sticky preset id + last shared state (the retry/rebuild restore source).
  let activePresetId: string | null = null;
  let lastShared: SharedState | null = null;

  /**
   * T14 share URL: adapter base + '#' + canonical serialization of the CURRENT
   * state. `lastShared` is kept fresh by every state-event push (and the flush
   * in the share handler below), so this is never a stale read of a fake
   * location's hash — injected locs don't mirror `replaceState` back.
   */
  const getShareUrl: GetShareUrl =
    opts.getShareUrl ??
    ((): string => {
      const state = lastShared ?? { ...DEFAULT_SHARED_STATE };
      return `${readShareBase(loc)}#${serializeState(state)}`;
    });

  let disposeStack: () => void = () => {};

  const buildStack = (): Stack => {
    const { controller, renderer } = createBundle();
    const animation = createAnimation(renderer, animationEnv);
    // Generate-class input mid-animation cancels to the final frame (T8 skip).
    controller.setAnimationCancel(() => {
      animation.skip();
      return true;
    });
    const unsubscribeEvents = controller.subscribe((e: PanelControllerEvent) => {
      for (const listener of [...eventListeners]) listener(e);
    });
    const unsubscribeStages = animation.onStageChange((s: AnimationStage) => {
      for (const listener of [...stageListeners]) listener(s);
    });
    disposeStack = () => {
      unsubscribeEvents();
      unsubscribeStages();
      animation.dispose();
      // T16-fix (F2): dispose now also terminates the bundle's worker client
      // (wired in createMapController) — debounce cleared, in-flight worker
      // resolutions settle silently, and the worker thread is released, so
      // retries/rebuilds leak zero live workers.
      controller.dispose();
    };
    return { controller, animation, renderer };
  };

  let stack = buildStack();

  /**
   * Polish: while the staged reveal plays, the canvas itself carries the skip
   * affordance — pointer cursor + a native tooltip invite the click, and
   * aria-busy tells assistive tech a new map is arriving. Any stage
   * announcement means the reveal owns the surface; 'done' hands it back to
   * the probe. Registered on the stable listener set, so it survives rebuilds.
   */
  stageListeners.add((stage) => {
    const revealing = stage !== 'done';
    canvas.classList.toggle('revealing', revealing);
    canvas.setAttribute('aria-busy', revealing ? 'true' : 'false');
    if (revealing) canvas.title = 'Click to skip the reveal';
    else canvas.removeAttribute('title');
  });

  /**
   * Play the staged reveal for a Generate-class arrival. `play()` resolves
   * 'done' in every path (including reduced motion and skip), so the catch is
   * purely a no-unhandled-rejection guard.
   */
  const playStaged = (): void => {
    void stack.animation.play().catch((error: unknown) => {
      console.error('[startApp] staged animation failed', error);
    });
  };

  /** Keep the URL hash (and `lastShared`) current with the live state. */
  const pushUrlState = (): void => {
    const s = stack.controller.state;
    lastShared = {
      version: STATE_VERSION,
      seed: s.seed,
      elevation: s.elevation,
      moisture: s.moisture,
      preset: activePresetId,
    };
    writer.push(lastShared);
  };

  const appListener = (e: PanelControllerEvent): void => {
    if (e.type === 'fields') {
      // Generate-class arrivals animate; elevation-commit arrivals are already
      // drawn instantly by the controller (T11 animation routing).
      if (e.final === true && e.cause === 'generate') playStaged();
      return;
    }
    if (e.type === 'state') {
      // STICKY-OFF preset tracking: only the loss of terrain overrides (an
      // elevation drag/commit cleared them in the controller) may un-set the
      // id. Moisture tweaks keep it; slider coincidence never re-derives it.
      if (!stack.controller.hasOverrides) activePresetId = null;
      pushUrlState();
    }
  };
  eventListeners.add(appListener);

  /**
   * Rebuild the stack (fresh worker, D5) and restore the LAST known shared
   * state — seed + sliders + preset — via one `applySharedState` batch. This
   * replaces the old capture-seed-only retry: slider positions and the preset
   * now survive a worker failure (they are applied with the regenerate, never
   * drawn against the empty pre-fields renderer).
   */
  const rebuild = (): void => {
    disposeStack();
    stack = buildStack();
    if (lastShared !== null) {
      stack.controller.applySharedState({
        seed: lastShared.seed,
        elevation: lastShared.elevation,
        moisture: lastShared.moisture,
        presetId: activePresetId,
      });
    }
  };

  const ports: ControlPanelPorts = {
    controller: {
      setElevation: (v, o) => stack.controller.setElevation(v, o),
      commitElevation: () => stack.controller.commitElevation(),
      setMoisture: (v) => stack.controller.setMoisture(v),
      setSeed: (seed) => stack.controller.setSeed(seed),
      regenerate: (seed) => stack.controller.regenerate(seed),
      // T12: one batch — both sliders + overrides + ONE Generate-class regen.
      // The click sets the sticky id; the controller keeps overrides live
      // until an elevation input clears them (mirrored above).
      applyPreset: (preset) => {
        activePresetId = preset.id;
        stack.controller.applyPreset(preset);
      },
      // P1-2 (clarify): the sticky id is the ONE truth for the pressed chip —
      // the same value the share URL carries, so they can never disagree.
      activePresetId: () => activePresetId,
      subscribe: (fn) => {
        eventListeners.add(fn);
        return () => {
          eventListeners.delete(fn);
        };
      },
    },
    animation: {
      skip: () => stack.animation.skip(),
      onStageChange: (cb) => {
        stageListeners.add(cb);
        return () => {
          stageListeners.delete(cb);
        };
      },
      get playing() {
        return stack.animation.playing;
      },
    },
    // D5 retry: rebuild the whole stack around a fresh worker; `rebuild()`
    // re-applies the last shared state (see above).
    onRetry: () => {
      rebuild();
    },
    // T14 share: the URL must be CURRENT — flush the coalescing writer first
    // (a just-changed slider is up to 200 ms stale in the hash otherwise) —
    // then copy, degrading gracefully: clipboard API → execCommand textarea →
    // selectable fallback region on the panel.
    onShare: (): void => {
      writer.flush();
      const url = getShareUrl();
      void clipboardWrite(url).then((copied) => {
        if (copied) {
          panel.flashShareSuccess();
          return;
        }
        if (legacyCopyViaTextarea(url, execCommand)) {
          panel.flashShareSuccess();
          return;
        }
        panel.showShareFallbackUrl(url); // last resort: visible, selectable text
      });
    },
    // T14 export: PNG download of the live canvas. A null blob (no bitmap)
    // is a silent no-op — there is nothing user-actionable to report.
    onExport: (): void => {
      const run = async (): Promise<void> => {
        // Harden (critique P2-4): settle the reveal before capturing. A
        // mid-crossfade `toBlob` ships a half-blended frame named like a
        // final one; `skip()` draws the composed biomes frame synchronously
        // and is a no-op when nothing is playing.
        stack.animation.skip();
        const blob = await toBlob(canvas);
        if (blob === null) return;
        const url = createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.download = `biome-generator-${String(stack.controller.state.seed)}.png`;
        anchor.href = url;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        revokeObjectURL(url);
      };
      void run().catch((error: unknown) => {
        console.error('[startApp] PNG export failed', error);
      });
    },
  };

  // Map status lives with the map: the panel drives the stage label, but its
  // DOM home is the #stage-status caption block under the canvas (beside the
  // probe reading) — status of the specimen belongs to the specimen.
  const stageStatusHost = document.querySelector<HTMLElement>('#stage-status');
  const panel = buildControlPanel(controls, ports, { stageHost: stageStatusHost ?? undefined });
  panel.bindCanvasSkip(canvas);

  // The map's key (onboard): swatches from the same BIOMES data the renderer
  // classifies with, so the legend can never drift from the pixels it
  // explains. The skeleton is part of the layout contract (index.html).
  const legendSwatches = document.querySelector<HTMLElement>('#legend-swatches');
  if (legendSwatches === null) {
    throw new Error('startApp: #legend-swatches not found (see index.html)');
  }
  populateBiomeLegend(legendSwatches);

  // ---- boot (T11): restore-from-hash or default-preset auto-generate -------
  // T3c-fix: the bare branch boots the preset's OWN slider positions (see
  // `bareBootState`), so first load IS the calibrated continent map; a
  // stateful URL still wins verbatim (explicit el/mo/preset/seed are applied
  // as the sharer left them).
  //
  // ORDER (clarify P1-2): the panel must exist before boot fires its state
  // events — otherwise sliders, seed field, and the preset chip render build
  // defaults while the URL and the map restore the sharer's state (a
  // stateful #mo=1 boot showed slider 0.5 against a moisture-1.0 map).
  const bootState: SharedState = readStateFromLocation(loc) ?? bareBootState();
  activePresetId = bootState.preset; // kept iff applySharedState installs overrides
  stack.controller.applySharedState({
    seed: bootState.seed,
    elevation: bootState.elevation,
    moisture: bootState.moisture,
    presetId: bootState.preset,
  });
  pushUrlState(); // the state-event push already ran; this pins the boot state

  // Surveyor's Probe (delight): crosshair + live reading over the specimen.
  // Getters read the CURRENT stack, so a D5 rebuild (fresh renderer+fields)
  // re-targets the probe automatically — before the first fields land it
  // simply stays dark (sample undefined).
  const probe = attachCanvasProbe(canvas, {
    sample: (fx, fy) => stack.renderer.sample(fx, fy),
    fieldResolution: () => stack.renderer.fieldResolution,
    biases: () => stack.controller.biases,
  });

  // Harden (critique P1-1): every controller event refreshes the probe's
  // parked station — a moisture turn re-names the pixel under the parked
  // crosshair (principle 1: reveal, don't just render), and fresh fields
  // re-read whatever the station now sits on. Registered AFTER the probe
  // exists, so boot-time events (no station yet) never reach it; the stable
  // listener set keeps the subscription alive across D5 rebuilds.
  eventListeners.add(() => probe.refresh());

  return {
    panel,
    rebuild,
    getActivePreset: () => activePresetId,
    dispose(): void {
      writer.flush(); // land any coalesced write before tearing everything down
      panel.destroy();
      probe.destroy();
      disposeStack();
    },
  };
}
