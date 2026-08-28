/**
 * Update controller (plan T6, D2 preview path): routes the three committed
 * control semantics onto narrow worker/renderer ports.
 *
 * - moisture slider  → instant local reclassify (renderer LUT rebuild only;
 *   the worker is NEVER called on this path — D2's palette-LUT decision
 *   exists for exactly this).
 * - elevation slider → trailing-debounce (~30ms) elevation recompute at 256²
 *   while dragging (D2 preview), 512² recompute on commit (pointer-up /
 *   change, via `commitElevation()` or `setElevation(v, {commit: true})`).
 *   Previews need moisture@256 once per seed (cached; v1's moisture params are
 *   seed-independent), after which only the elevation channel runs per drag.
 * - seed / Generate   → full 512² `generate` (`regenerate(seed?)` / `setSeed`).
 *   Generate-class starts fire the registered animation-cancel hook FIRST,
 *   fire-and-forget — never queue, never block (T8 owns the choreography).
 * - preset            → `applyPreset` (T12): one batch = both slider positions
 *   + field-param overrides + ONE Generate-class regen. Manual elevation
 *   input clears the overrides (custom terrain); moisture input never does
 *   (classification-only); regenerate/setSeed keep them.
 * - boot/restore       → `applySharedState` (T11): one batch = seed + both
 *   sliders + preset overrides (iff the id resolves) + ONE Generate-class
 *   regen — the single-churn path for first load and shared-URL restore.
 *   Final `fields` events carry a `cause` ('generate' vs 'elevation-commit')
 *   so T11 animates Generate-class arrivals and keeps commits instant.
 *
 * Ports are structural interfaces so the whole controller is Node-testable
 * without DOM or worker (see map-controller.test.ts). The controller assumes
 * fields are delivered before user reclassify input (T10/T11 guarantee the
 * first-load auto-generate precedes any slider interaction).
 */
import { DEFAULT_FIELD_PARAMS } from '../generation/index.ts';
import type { ClassifyBiases, FieldParams, Fields } from '../generation/index.ts';
import { SupersededError } from '../worker/client.ts';
import { findPreset } from '../presets/index.ts';

/** Final render resolution (D2: fixed 512² internal). */
const FINAL_RESOLUTION = 512;

/** Moisture slider [0,1] (center 0.5) → moistureBias ±0.4. */
const MOISTURE_BIAS_SPAN = 0.8;

/** Elevation slider [0,1] → elevationFreq 2.5..4.5 (center 0.5 → 3.5 default). */
function elevationFreqFor(elevation: number): number {
  return 2.5 + 2 * elevation;
}

/** Elevation slider [0,1] → redistribution 1.2..1.8 (center 0.5 → 1.5 default). */
function redistributionFor(elevation: number): number {
  return 1.2 + 0.6 * elevation;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Why a final 512² fields frame arrived (T11's animation routing key):
 * 'generate' = Generate-class arrival (boot/restore, Generate button, 🎲,
 * preset click) → the caller plays the staged animation; 'elevation-commit' =
 * elevation release → instant by design, never animated.
 */
export type FieldsCause = 'generate' | 'elevation-commit';

/** One dispatched lifecycle event (the dispatchable union of `ControllerEvents`). */
export type ControllerEvent =
  | {
      type: 'fields';
      fields: Fields;
      final: boolean;
      /** T11: which path produced this final frame (see `FieldsCause`). */
      cause: FieldsCause;
    } // final=true when 512² arrives (regenerate/commit)
  | { type: 'preview'; fields: Fields } // 256² preview during elevation drag
  | { type: 'error'; error: Error } // worker failures (SupersededError filtered out)
  | { type: 'state'; state: ControlState }; // emitted on every control change

export interface ControllerEvents {
  (e: { type: 'fields'; fields: Fields; final: boolean; cause: FieldsCause }): void;
  (e: { type: 'preview'; fields: Fields }): void;
  (e: { type: 'error'; error: Error }): void;
  (e: { type: 'state'; state: ControlState }): void;
}

export interface ControlState {
  seed: number;
  /** Elevation slider position, [0,1]. */
  elevation: number;
  /** Moisture slider position, [0,1]. */
  moisture: number;
}

/** T8 registers this; returns whether an animation was cancelled. */
export interface AnimationCancelHook {
  (): boolean;
}

/** The worker slice the controller touches (satisfied by `MapWorkerClient`). */
export interface WorkerPort {
  generate(seed: number, params: FieldParams, resolution: number): Promise<Fields>;
  recomputeElevation(seed: number, params: FieldParams, resolution: number): Promise<Float32Array>;
}

/** The renderer slice the controller touches (satisfied by `MapRenderer`). */
export interface RendererPort {
  setFields(fields: Fields): void;
  rebuildBiomes(biases: ClassifyBiases): void;
  draw(mode: 'elevation' | 'moisture' | 'biomes'): void;
}

/** Internal dispatch target: the overloaded listener accepts the whole union. */
type ListenerFn = (e: ControllerEvent) => void;

export class MapController {
  private readonly worker: WorkerPort;
  private readonly renderer: RendererPort;
  private readonly previewResolution: number;
  private readonly debounceMs: number;

  private readonly listeners = new Set<ControllerEvents>();
  private cancelHook: AnimationCancelHook | undefined;

  private seedValue = 0;
  private elevationValue = 0.5;
  private moistureValue = 0.5;

  /**
   * Preset field-param overrides (T12), layered over the slider-derived params
   * in `fieldParams` — override keys win over both defaults and slider-derived
   * values for the keys they carry. `null` = fully slider-derived terrain.
   */
  private paramOverrides: Partial<FieldParams> | null = null;

  /** Latest 512² fields (null until the first generate/commit resolves). */
  private fields512: Fields | null = null;
  /**
   * 256² moisture half per seed. V1's moisture-affecting params never vary,
   * so the cache key is the seed alone; entries are ~256KB each and live for
   * the session (bounded by the number of distinct seeds used).
   */
  private readonly previewMoistureCache = new Map<number, Float32Array>();

  /** Trailing-debounce handle for the elevation drag preview (vitest-fakeable). */
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Bumps on every Generate-class start (regenerate/setSeed); a response from
   * an older generation must never render — e.g. a 512² elevation answer
   * arriving after a new regenerate.
   */
  private genEpoch = 0;

  /**
   * Bumps on EVERY worker request issuance (regenerate, commit, preview fire).
   * Generate and elevation are independent worker channels, so the worker's
   * latest-wins only guards superseding WITHIN a channel. This epoch closes
   * the cross-channel hole: e.g. a slow cache-miss preview `generate@256`
   * resolving after a commit's 512² frame must not clobber it. A response
   * publishes only if it is still the latest issuance overall (which also
   * subsumes the genEpoch check, kept explicit for clarity).
   */
  private issueEpoch = 0;

  /**
   * Set by `dispose()` (T10 retry: the whole stack is torn down and rebuilt
   * around a fresh worker, D5). Once dead, public mutators are no-ops and
   * in-flight worker resolutions settle silently — a disposed controller must
   * never render, emit, or surface a stale error.
   */
  private disposed = false;

  /**
   * T16-fix (F2): resource-release hook fired exactly once by `dispose()`.
   * `createMapController` wires `() => client.terminate()` here so the
   * worker thread is released WITH the controller instead of leaking one
   * live worker per retry/rebuild (the bundle's public shape is unchanged;
   * the client is internal wiring). Fires after `disposed` is set, so the
   * `WorkerCrashError` rejections `terminate()` raises on in-flight requests
   * are absorbed by the settle-silently guards — no error events, no
   * unhandled rejections.
   */
  private readonly onDispose: (() => void) | undefined;

  constructor(deps: {
    worker: WorkerPort;
    renderer: RendererPort;
    previewResolution?: number; // default 256 (D2)
    debounceMs?: number; // default ~30 (D2)
    /** See `onDispose` field above — called once by dispose(). */
    onDispose?: () => void;
  }) {
    this.worker = deps.worker;
    this.renderer = deps.renderer;
    this.previewResolution = deps.previewResolution ?? 256;
    this.debounceMs = deps.debounceMs ?? 30;
    this.onDispose = deps.onDispose;
  }

  subscribe(listener: ControllerEvents): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setAnimationCancel(hook: AnimationCancelHook): void {
    this.cancelHook = hook;
  }

  /**
   * T10 retry path: mark this controller dead and release its resources.
   * Idempotent (first call wins): clears the pending debounce, drops
   * listeners and the cancel hook, then fires the `onDispose` hook once —
   * which terminates the owning worker client in the production wiring
   * (`createMapController`, T16-fix F2). Every worker `.then`/`.catch` below
   * checks `disposed`, so the rejections `terminate()` raises on in-flight
   * requests settle silently (no render, no emit, no error surface, no
   * unhandled rejections). The REPLACEMENT worker/client is created by the
   * next `createMapController` call (D5: never reuse a terminated worker).
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearDebounce();
    this.listeners.clear();
    this.cancelHook = undefined;
    this.onDispose?.();
  }

  get state(): ControlState {
    return { seed: this.seedValue, elevation: this.elevationValue, moisture: this.moistureValue };
  }

  /** The 512² cache, or null before the first generate/commit resolves. */
  get currentFields(): Fields | null {
    return this.fields512;
  }

  /** Classification biases derived from the moisture slider (±0.4). */
  get biases(): ClassifyBiases {
    return {
      seaLevelBias: 0,
      moistureBias: (this.moistureValue - 0.5) * MOISTURE_BIAS_SPAN,
    };
  }

  /** Field params derived from the elevation slider over seed-independent defaults. */
  get fieldParams(): FieldParams {
    return {
      ...DEFAULT_FIELD_PARAMS,
      elevationFreq: elevationFreqFor(this.elevationValue),
      redistribution: redistributionFor(this.elevationValue),
      // Preset overrides (T12) win over defaults/slider-derived for their keys.
      ...(this.paramOverrides ?? {}),
    };
  }

  /**
   * T11: whether preset field-param overrides are currently installed. This is
   * the "is terrain still preset-shaped" signal the app's sticky preset id
   * tracks — cleared by manual elevation input only (see `applyPreset`).
   */
  get hasOverrides(): boolean {
    return this.paramOverrides !== null;
  }

  /**
   * Generate-class: cancel any active animation first (fire-and-forget), then
   * request a full 512² generation. `seed` defaults to the current seed.
   */
  regenerate(seed?: number): void {
    if (this.disposed) return;
    this.cancelAnimation();
    if (seed !== undefined) {
      this.seedValue = seed;
      this.emitState();
    }
    const genEpoch = ++this.genEpoch;
    const issueEpoch = ++this.issueEpoch;
    this.worker
      .generate(this.seedValue, this.fieldParams, FINAL_RESOLUTION)
      .then((fields) => {
        if (this.disposed || genEpoch !== this.genEpoch || issueEpoch !== this.issueEpoch) return;
        this.finalizeFields(fields);
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        this.handleWorkerError(error);
      });
  }

  /** Generate-class alias for `regenerate(seed)`. */
  setSeed(seed: number): void {
    this.regenerate(seed);
  }

  /**
   * Preset batch apply (plan T12): clamp both sliders, install (or clear, on
   * `overrides: null`) the preset's field-param overrides, cancel any pending
   * elevation-drag debounce, then fire exactly ONE Generate-class
   * `regenerate()` — which fires the animation-cancel hook FIRST (T8 skip).
   * One state event carries the whole batch (both slider positions).
   *
   * Override-clearing semantics (decided in T12): a MANUAL elevation input
   * (`setElevation`, drag or commit form) clears the overrides — the terrain
   * is "custom" and fully slider-derived again from the next worker request.
   * `setMoisture` does NOT clear them (moisture is classification-only by
   * committed scope — a climate nudge must never change terrain character),
   * and `regenerate`/`setSeed` keep them (Generate re-runs the current
   * params; a seed change is not a param change).
   */
  applyPreset(p: {
    elevation: number;
    moisture: number;
    overrides: Partial<FieldParams> | null;
  }): void {
    if (this.disposed) return;
    this.elevationValue = clamp01(p.elevation);
    this.moistureValue = clamp01(p.moisture);
    this.paramOverrides = p.overrides === null ? null : { ...p.overrides };
    this.clearDebounce(); // a pending drag preview must never follow the regen
    this.emitState();
    this.regenerate();
  }

  /**
   * Batch boot/restore path (plan T11): set the whole shared state in ONE step —
   * clamped sliders + floored non-negative seed, preset overrides installed iff
   * `presetId` resolves in the registry (`findPreset`; an unknown/absent id
   * leaves the terrain fully slider-derived) — then exactly ONE Generate-class
   * `regenerate()`. Emits exactly ONE state event (no storm) and causes no
   * intermediate worker churn (a single `generate@512` total). This is the only
   * path that should restore a shared URL: the same params (slider-derived +
   * preset overrides) reach the worker the sharer's session ended with, so the
   * restored map is identical.
   */
  applySharedState(s: {
    seed: number;
    elevation: number;
    moisture: number;
    presetId: string | null;
  }): void {
    if (this.disposed) return;
    this.seedValue = Math.max(0, Math.floor(s.seed));
    this.elevationValue = clamp01(s.elevation);
    this.moistureValue = clamp01(s.moisture);
    const preset = findPreset(s.presetId);
    this.paramOverrides = preset === null ? null : { ...preset.overrides };
    this.clearDebounce(); // a pending drag preview must never follow the restore
    this.emitState();
    this.regenerate();
  }

  /**
   * Instant path: clamp to [0,1], reclassify locally via the renderer's biome
   * LUT. The worker is never involved.
   */
  setMoisture(v: number): void {
    if (this.disposed) return;
    this.moistureValue = clamp01(v);
    this.emitState();
    this.renderer.rebuildBiomes(this.biases);
    this.renderer.draw('biomes');
  }

  /**
   * Elevation path. Default (drag) resets the trailing debounce; on fire, a
   * 256² preview recompute runs. `commit: true` (or `commitElevation()`)
   * cancels the pending debounce and requests the 512² recompute immediately.
   */
  setElevation(v: number, opts?: { commit?: boolean }): void {
    if (this.disposed) return;
    this.elevationValue = clamp01(v);
    this.paramOverrides = null; // manual terrain input → custom (see applyPreset)
    this.emitState();
    if (opts?.commit) {
      this.clearDebounce();
      this.requestFinalFields();
    } else {
      this.schedulePreview();
    }
  }

  /** T10 calls this on pointer-up / `change` to finalize an elevation drag. */
  commitElevation(): void {
    if (this.disposed) return;
    this.clearDebounce();
    this.requestFinalFields();
  }

  private cancelAnimation(): void {
    this.cancelHook?.(); // fire-and-forget: whether one was cancelled is T8's bookkeeping
  }

  private schedulePreview(): void {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.runPreview();
    }, this.debounceMs);
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  /**
   * One preview tick at 256². Cache miss → a single `generate@256` supplies
   * BOTH fields for this preview (no extra recompute) and its moisture half is
   * cached for the seed. Cache hit → elevation-only recompute composed with
   * the cached moisture.
   */
  private runPreview(): void {
    const seed = this.seedValue;
    const genEpoch = this.genEpoch;
    const issueEpoch = ++this.issueEpoch;
    const cachedMoisture = this.previewMoistureCache.get(seed);

    if (cachedMoisture !== undefined) {
      this.worker
        .recomputeElevation(seed, this.fieldParams, this.previewResolution)
        .then((elevation) => {
          if (this.disposed || genEpoch !== this.genEpoch || issueEpoch !== this.issueEpoch) return;
          this.publishPreview({
            elevation,
            moisture: cachedMoisture,
            resolution: this.previewResolution,
          });
        })
        .catch((error: unknown) => {
          if (this.disposed) return;
          this.handleWorkerError(error);
        });
    } else {
      this.worker
        .generate(seed, this.fieldParams, this.previewResolution)
        .then((fields) => {
          if (this.disposed || genEpoch !== this.genEpoch || issueEpoch !== this.issueEpoch) return;
          this.previewMoistureCache.set(seed, fields.moisture);
          this.publishPreview(fields);
        })
        .catch((error: unknown) => {
          if (this.disposed) return;
          this.handleWorkerError(error);
        });
    }
  }

  /**
   * 512² finalization for an elevation commit. With a cached 512² moisture
   * half, only elevation is recomputed; before any generate has resolved there
   * is nothing to recombine, so a full generate is requested instead (same
   * settlement path as `regenerate`).
   */
  private requestFinalFields(): void {
    const seed = this.seedValue;
    const genEpoch = this.genEpoch;
    const issueEpoch = ++this.issueEpoch;
    const cached = this.fields512;

    if (cached !== null) {
      this.worker
        .recomputeElevation(seed, this.fieldParams, FINAL_RESOLUTION)
        .then((elevation) => {
          if (this.disposed || genEpoch !== this.genEpoch || issueEpoch !== this.issueEpoch) return;
          this.finalizeFields(
            {
              elevation,
              moisture: cached.moisture,
              resolution: FINAL_RESOLUTION,
            },
            'elevation-commit',
          );
        })
        .catch((error: unknown) => {
          if (this.disposed) return;
          this.handleWorkerError(error);
        });
    } else {
      this.worker
        .generate(seed, this.fieldParams, FINAL_RESOLUTION)
        .then((fields) => {
          if (this.disposed || genEpoch !== this.genEpoch || issueEpoch !== this.issueEpoch) return;
          this.finalizeFields(fields, 'elevation-commit');
        })
        .catch((error: unknown) => {
          if (this.disposed) return;
          this.handleWorkerError(error);
        });
    }
  }

  /**
   * Cache + render a 512² frame and announce it as final. `cause` defaults to
   * 'generate' (the regenerate/applyPreset/applySharedState path); the
   * elevation-commit path passes 'elevation-commit' so T11 can keep those
   * arrivals instant (no staged animation).
   */
  private finalizeFields(fields: Fields, cause: FieldsCause = 'generate'): void {
    this.fields512 = fields;
    this.renderer.setFields(fields);
    this.renderer.rebuildBiomes(this.biases);
    this.renderer.draw('biomes');
    this.emit({ type: 'fields', fields, final: true, cause });
  }

  /** Render a 256² preview frame (never touches the 512² cache). */
  private publishPreview(fields: Fields): void {
    this.renderer.setFields(fields);
    this.renderer.rebuildBiomes(this.biases);
    this.renderer.draw('biomes');
    this.emit({ type: 'preview', fields });
  }

  /**
   * Superseded rejections are the worker client's latest-wins bookkeeping —
   * silent by design. Everything else surfaces as an error event; nothing is
   * rethrown, and settle guards above make double-settle a no-op.
   */
  private handleWorkerError(error: unknown): void {
    if (error instanceof SupersededError) return;
    this.emit({
      type: 'error',
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }

  private emitState(): void {
    this.emit({ type: 'state', state: this.state });
  }

  private emit(event: ControllerEvent): void {
    // Snapshot: a listener unsubscribing mid-dispatch must not mutate the loop.
    for (const listener of [...this.listeners]) {
      (listener as ListenerFn)(event);
    }
  }
}
