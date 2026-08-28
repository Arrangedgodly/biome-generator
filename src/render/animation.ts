/**
 * Staged reveal animation: Elevation → Moisture → Biomes (plan T8; frame
 * strategy D2, `docs/ultron/research/rq2-resolution-performance.md`).
 *
 * D2 rule: never recompose pixels per frame. Stage frames are the renderer's
 * pre-composed mode surfaces; transitions are `renderer.crossfade` — two
 * GPU-composited drawImage blits with globalAlpha. All timing taste lives in
 * ONE config object (default total 2 × (stageMs + transitionMs) = 2800 ms,
 * inside the committed 2.5–4 s band).
 *
 * `skip()` is also the mid-animation input-cancel path (T10 registers it via
 * `MapController.setAnimationCancel`): fully synchronous — cancel the pending
 * frame, one opaque draw('biomes') — so the final frame lands well under the
 * 100 ms budget; nothing is ever queued and nothing blocks. Reduced motion
 * bypasses frames entirely. Stage-entry announcements (`onStageChange`) feed
 * the aria-live region; T10 wires the DOM side.
 */

import type { RenderMode } from './compose.ts';

export type AnimationStage = 'elevation' | 'moisture' | 'biomes' | 'done';

export interface AnimationConfig {
  /** Hold time per stage before its crossfade out (ms). */
  stageMs: number;
  /** Crossfade duration between stages (ms). */
  transitionMs: number;
  /** Easing applied to crossfade progress. */
  easing: (t: number) => number;
}

/**
 * Quadratic ease-in-out: f(0)=0, f(1)=1, f(0.5)=0.5, symmetric about the
 * midpoint (f(x) + f(1−x) = 1). Input clamped to [0, 1].
 */
export function easeInOutQuad(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c < 0.5 ? 2 * c * c : 1 - (-2 * c + 2) ** 2 / 2;
}

export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  stageMs: 1000,
  transitionMs: 400,
  easing: easeInOutQuad,
};

/** Narrow renderer port (structural — MapRenderer satisfies it; tests fake it). */
export interface AnimationRendererPort {
  draw(mode: RenderMode): void;
  crossfade(from: RenderMode, to: RenderMode, t: number): void;
}

/** Injectable environment: frame scheduling, wall clock, motion preference. */
export interface AnimationEnv {
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  prefersReducedMotion?: boolean;
}

/** ~60 fps fallback when requestAnimationFrame is unavailable (node, tests). */
const FRAME_FALLBACK_MS = 16;

function defaultRequestFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(cb, FRAME_FALLBACK_MS) as unknown as number;
}

function defaultCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as Parameters<typeof clearTimeout>[0]);
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * One play() run. `settled` runs cannot draw or announce again; ticks compare
 * `this.run === run` so callbacks from a cancelled/replaced run are inert even
 * if a scheduler fires them after cancelFrame.
 */
interface RunState {
  readonly startedAt: number;
  readonly resolve: (stage: AnimationStage) => void;
  /** Stages already announced this run (announce-once semantics). */
  readonly announced: Set<AnimationStage>;
  frameHandle: number | null;
  settled: boolean;
}

export class StagedAnimation {
  private readonly renderer: AnimationRendererPort;
  private readonly config: AnimationConfig;
  private readonly requestFrame: (cb: () => void) => number;
  private readonly cancelFrameFn: (handle: number) => void;
  private readonly now: () => number;
  private readonly reducedMotion: boolean;
  private readonly listeners = new Set<(stage: AnimationStage) => void>();
  private run: RunState | null = null;
  private stage: AnimationStage | null = null;

  constructor(renderer: AnimationRendererPort, config?: Partial<AnimationConfig>, env?: AnimationEnv) {
    this.renderer = renderer;
    this.config = { ...DEFAULT_ANIMATION_CONFIG, ...config };
    this.requestFrame = env?.requestFrame ?? defaultRequestFrame;
    this.cancelFrameFn = env?.cancelFrame ?? defaultCancelFrame;
    this.now = env?.now ?? defaultNow;
    this.reducedMotion = env?.prefersReducedMotion === true;
  }

  /** Stage-entry hook for aria-live announcements (T10 wires). Returns unsubscribe. */
  onStageChange(cb: (stage: AnimationStage) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  get playing(): boolean {
    return this.run !== null;
  }

  /** Most recently announced stage; null before the first run and after dispose(). */
  get currentStage(): AnimationStage | null {
    return this.stage;
  }

  /**
   * Play the full staged reveal over the already-set fields. Resolves 'done'.
   * Reduced motion: final frame immediately, no scheduled frames. Already
   * playing: the current run is skipped first (never queue, never block).
   */
  play(): Promise<AnimationStage> {
    if (this.reducedMotion) {
      this.renderer.draw('biomes');
      this.emit('biomes');
      this.emit('done');
      return Promise.resolve('done');
    }
    if (this.run !== null) this.skip();

    let resolveRun!: (stage: AnimationStage) => void;
    const finished = new Promise<AnimationStage>((resolve) => {
      resolveRun = resolve;
    });
    const run: RunState = {
      startedAt: this.now(),
      resolve: resolveRun,
      announced: new Set<AnimationStage>(),
      frameHandle: null,
      settled: false,
    };
    this.run = run;
    this.announce(run, 'elevation');
    this.renderer.draw('elevation');
    this.schedule(run);
    return finished;
  }

  /**
   * Skip/cancel: stop frames, jump to the final biome frame synchronously,
   * resolve the pending promise with 'done'. Announces only 'biomes' (if not
   * already announced) then 'done' — skipped stage names are never replayed.
   * Safe when not playing (no-op).
   *
   * T16-fix (F1): the run is settled BEFORE the terminal 'done' announcement,
   * so listeners observing `playing` when 'done' arrives see false (the
   * control panel drives Skip enablement off stage events — announcing before
   * settling left the button enabled with a dead click target).
   */
  skip(): void {
    const run = this.run;
    if (run === null) return;
    this.cancelRunFrame(run);
    this.renderer.draw('biomes');
    this.announce(run, 'biomes');
    this.settle(run); // null the run first: 'done' must observe playing === false
    this.announce(run, 'done');
  }

  /**
   * Hard stop WITHOUT drawing the final frame (teardown). Any pending play()
   * promise still resolves 'done' — deliberately, so awaits never dangle —
   * even though the final frame was never rendered; no announcements fire and
   * listeners are dropped. currentStage resets to null.
   */
  dispose(): void {
    const run = this.run;
    if (run !== null) {
      this.cancelRunFrame(run);
      this.settle(run);
    }
    this.listeners.clear();
    this.stage = null;
  }

  private schedule(run: RunState): void {
    run.frameHandle = this.requestFrame(() => this.tick(run));
  }

  private tick(run: RunState): void {
    run.frameHandle = null;
    if (this.run !== run || run.settled) return;

    const { stageMs, transitionMs, easing } = this.config;
    const fade1Start = stageMs;
    const fade2Start = 2 * stageMs + transitionMs;
    const total = fade2Start + transitionMs;
    const elapsed = this.now() - run.startedAt;

    if (elapsed >= total) {
      // Last crossfade frame at t=1, then one guaranteed-opaque draw so no
      // half-blended residue remains (crossfade at t=1 leaves alpha bits
      // from the outgoing frame's 0-alpha pass in the compositor state).
      this.renderer.crossfade('moisture', 'biomes', easing(1));
      this.renderer.draw('biomes');
      this.announce(run, 'biomes'); // clock-jump safety: ending implies stage entry
      // T16-fix (F1): settle before the terminal 'done' announcement — the
      // panel's Skip enablement reads `playing` at stage events, so 'done'
      // must arrive with the run already settled (same order as skip()).
      this.settle(run);
      this.announce(run, 'done');
      return;
    }
    if (elapsed >= fade2Start) {
      this.announce(run, 'biomes');
      this.renderer.crossfade('moisture', 'biomes', easing((elapsed - fade2Start) / transitionMs));
    } else if (elapsed >= fade1Start && elapsed <= fade1Start + transitionMs) {
      // End-inclusive: the final fade-1 frame draws moisture at full opacity,
      // so the subsequent hold never sits on a half-blended frame.
      this.announce(run, 'moisture');
      this.renderer.crossfade('elevation', 'moisture', easing((elapsed - fade1Start) / transitionMs));
    }
    // Holds draw nothing: the elevation frame was drawn synchronously in
    // play(), and each finished crossfade leaves its target fully opaque.
    this.schedule(run);
  }

  /** Fires a stage announcement at most once per run; 'done' is always last. */
  private announce(run: RunState, stage: AnimationStage): void {
    if (run.announced.has(stage)) return;
    run.announced.add(stage);
    this.emit(stage);
  }

  private emit(stage: AnimationStage): void {
    this.stage = stage;
    for (const cb of [...this.listeners]) cb(stage);
  }

  private cancelRunFrame(run: RunState): void {
    if (run.frameHandle !== null) {
      this.cancelFrameFn(run.frameHandle);
      run.frameHandle = null;
    }
  }

  /** Idempotent terminal transition: stop frames, detach, resolve 'done'. */
  private settle(run: RunState): void {
    if (run.settled) return;
    run.settled = true;
    this.cancelRunFrame(run);
    if (this.run === run) this.run = null;
    run.resolve('done');
  }
}
