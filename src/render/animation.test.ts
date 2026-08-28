/**
 * StagedAnimation tests (plan T8): node environment, no DOM — the renderer is
 * a recording fake, frame scheduling is a manually-stepped queue, and the
 * clock is a mutable fake advanced by each step. Timeouts/debounce libraries
 * are never involved; every timing assertion is exact frame arithmetic on the
 * injected clock.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_ANIMATION_CONFIG, easeInOutQuad, StagedAnimation } from './animation.ts';
import type { AnimationConfig, AnimationRendererPort, AnimationStage } from './animation.ts';
import type { RenderMode } from './compose.ts';

type RenderCall =
  | { readonly kind: 'draw'; readonly mode: RenderMode }
  | { readonly kind: 'crossfade'; readonly from: RenderMode; to: RenderMode; t: number };

interface Harness {
  readonly anim: StagedAnimation;
  /** Renderer calls in order (draws + crossfades). */
  readonly calls: RenderCall[];
  /** Stage announcements in order. */
  readonly stages: AnimationStage[];
  /** Advance the fake clock by `ms`, then run every currently queued frame. */
  step(ms: number): void;
  /** Frames currently scheduled (0 once the run finishes or is cancelled). */
  pendingFrames(): number;
  /** Fake-clock value (starts at 0). */
  clock(): number;
  readonly unsubscribe: () => void;
}

function createHarness(
  options: { config?: Partial<AnimationConfig>; reducedMotion?: boolean } = {},
): Harness {
  let clock = 0;
  let nextHandle = 1;
  const frames: Array<{ handle: number; cb: () => void }> = [];
  const calls: RenderCall[] = [];
  const stages: AnimationStage[] = [];

  const requestFrame = (cb: () => void): number => {
    const handle = nextHandle++;
    frames.push({ handle, cb });
    return handle;
  };
  const cancelFrame = (handle: number): void => {
    const index = frames.findIndex((f) => f.handle === handle);
    if (index >= 0) frames.splice(index, 1);
  };
  const renderer: AnimationRendererPort = {
    draw(mode) {
      calls.push({ kind: 'draw', mode });
    },
    crossfade(from, to, t) {
      calls.push({ kind: 'crossfade', from, to, t });
    },
  };
  const anim = new StagedAnimation(renderer, options.config, {
    requestFrame,
    cancelFrame,
    now: () => clock,
    prefersReducedMotion: options.reducedMotion,
  });
  const unsubscribe = anim.onStageChange((stage) => {
    stages.push(stage);
  });

  return {
    anim,
    calls,
    stages,
    step(ms) {
      clock += ms;
      // Run only frames queued before this step; frames a callback schedules
      // fire on the NEXT step, mirroring one-in-flight rAF scheduling.
      for (const f of frames.splice(0)) f.cb();
    },
    pendingFrames: () => frames.length,
    clock: () => clock,
    unsubscribe,
  };
}

/** Steps until the animation finishes (no pending frames) or a guard fires. */
function driveToCompletion(h: Harness, stepMs: number, guardMs = 20000): number {
  let waited = 0;
  while (h.pendingFrames() > 0) {
    h.step(stepMs);
    waited += stepMs;
    if (waited > guardMs) throw new Error('animation did not finish within the guard window');
  }
  return h.clock();
}

function fadeSamples(calls: readonly RenderCall[], from: RenderMode, to: RenderMode): number[] {
  const out: number[] = [];
  for (const call of calls) {
    if (call.kind === 'crossfade' && call.from === from && call.to === to) out.push(call.t);
  }
  return out;
}

function expectMonotonic(samples: readonly number[]): void {
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
  }
}

describe('easeInOutQuad', () => {
  it('hits the endpoints and midpoint exactly', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBe(0.5);
  });

  it('is symmetric: f(0.25) + f(0.75) = 1', () => {
    expect(easeInOutQuad(0.25) + easeInOutQuad(0.75)).toBeCloseTo(1, 12);
  });
});

describe('DEFAULT_ANIMATION_CONFIG', () => {
  it('totals 2800 ms — inside the committed 2.5–4 s band', () => {
    expect(DEFAULT_ANIMATION_CONFIG.stageMs).toBe(1000);
    expect(DEFAULT_ANIMATION_CONFIG.transitionMs).toBe(400);
    expect(DEFAULT_ANIMATION_CONFIG.easing).toBe(easeInOutQuad);
    expect(2 * (DEFAULT_ANIMATION_CONFIG.stageMs + DEFAULT_ANIMATION_CONFIG.transitionMs)).toBe(2800);
  });
});

describe('StagedAnimation', () => {
  it('plays the full sequence: draw elevation → eased crossfades → final opaque biomes frame (test 1)', async () => {
    const h = createHarness();
    const finished = h.anim.play();

    // Stage entry + first frame are synchronous; nothing else drawn yet.
    expect(h.calls).toEqual([{ kind: 'draw', mode: 'elevation' }]);
    expect(h.stages).toEqual(['elevation']);
    expect(h.anim.playing).toBe(true);
    expect(h.anim.currentStage).toBe('elevation');

    const finalClock = driveToCompletion(h, 50);

    const fade1 = fadeSamples(h.calls, 'elevation', 'moisture');
    const fade2 = fadeSamples(h.calls, 'moisture', 'biomes');
    expect(fade1.length).toBeGreaterThanOrEqual(6);
    expect(fade1[0]).toBe(0); // t=0 on the first transition frame
    expect(fade1[fade1.length - 1]).toBe(1); // t=1 at transition end
    expectMonotonic(fade1);
    expect(fade2.length).toBeGreaterThanOrEqual(6);
    expect(fade2[0]).toBe(0);
    expect(fade2[fade2.length - 1]).toBe(1);
    expectMonotonic(fade2);

    // Ordering: elevation draw → fade 1 → fade 2 → opaque final biomes draw.
    const firstDraw = h.calls.findIndex((c) => c.kind === 'draw');
    const fade1At = h.calls.findIndex((c) => c.kind === 'crossfade' && c.from === 'elevation');
    const fade2At = h.calls.findIndex((c) => c.kind === 'crossfade' && c.from === 'moisture');
    expect(firstDraw).toBe(0);
    expect(fade1At).toBeGreaterThan(firstDraw);
    expect(fade2At).toBeGreaterThan(fade1At);
    expect(h.calls[h.calls.length - 2]).toEqual({ kind: 'crossfade', from: 'moisture', to: 'biomes', t: 1 });
    expect(h.calls[h.calls.length - 1]).toEqual({ kind: 'draw', mode: 'biomes' });

    const draws = h.calls.filter((c) => c.kind === 'draw');
    expect(draws).toEqual([
      { kind: 'draw', mode: 'elevation' },
      { kind: 'draw', mode: 'biomes' },
    ]);

    expect(h.stages).toEqual(['elevation', 'moisture', 'biomes', 'done']);
    expect(finalClock).toBeGreaterThanOrEqual(2700);
    expect(finalClock).toBeLessThanOrEqual(2900);
    expect(h.anim.playing).toBe(false);
    expect(h.anim.currentStage).toBe('done');
    expect(h.pendingFrames()).toBe(0);
    await expect(finished).resolves.toBe('done');
  });

  it('skip mid-transition lands the final frame synchronously with no deferred work (test 2)', async () => {
    const h = createHarness();
    const finished = h.anim.play();
    for (let i = 0; i < 21; i++) h.step(50); // clock 1050 — inside fade 1
    expect(fadeSamples(h.calls, 'elevation', 'moisture').length).toBeGreaterThan(0);
    const callsBefore = h.calls.length;

    h.anim.skip();

    // Exactly one new synchronous call: the opaque final frame.
    expect(h.calls.length).toBe(callsBefore + 1);
    expect(h.calls[h.calls.length - 1]).toEqual({ kind: 'draw', mode: 'biomes' });
    expect(h.stages).toEqual(['elevation', 'moisture', 'biomes', 'done']);
    expect(h.stages.filter((s) => s === 'done')).toHaveLength(1);
    expect(h.anim.playing).toBe(false);
    expect(h.pendingFrames()).toBe(0);

    // Skip work is fully synchronous — stepping the scheduler fires nothing.
    h.step(50);
    h.step(50);
    expect(h.calls.length).toBe(callsBefore + 1);
    await expect(finished).resolves.toBe('done');
  });

  it('skip when not playing is a no-op (test 3)', () => {
    const h = createHarness();
    h.anim.skip();
    expect(h.calls).toEqual([]);
    expect(h.stages).toEqual([]);
    expect(h.pendingFrames()).toBe(0);
    expect(h.anim.playing).toBe(false);
  });

  it('reduced motion: final map immediately, no frames (test 4)', async () => {
    const h = createHarness({ reducedMotion: true });
    const finished = h.anim.play();
    expect(h.calls).toEqual([{ kind: 'draw', mode: 'biomes' }]);
    expect(h.stages).toEqual(['biomes', 'done']);
    expect(h.pendingFrames()).toBe(0);
    expect(h.anim.playing).toBe(false);
    h.step(50);
    expect(h.calls).toEqual([{ kind: 'draw', mode: 'biomes' }]);
    await expect(finished).resolves.toBe('done');
  });

  it('play while playing skips the old run, then restarts the sequence (test 5)', async () => {
    const h = createHarness();
    const first = h.anim.play();
    for (let i = 0; i < 5; i++) h.step(50); // clock 250 — elevation hold
    expect(h.stages).toEqual(['elevation']);

    const second = h.anim.play();

    // Old run cancelled to its final state; new run already active at elevation.
    expect(h.calls.slice(0, 3)).toEqual([
      { kind: 'draw', mode: 'elevation' },
      { kind: 'draw', mode: 'biomes' }, // skip of run 1
      { kind: 'draw', mode: 'elevation' }, // run 2 restart
    ]);
    expect(h.stages.slice(0, 4)).toEqual(['elevation', 'biomes', 'done', 'elevation']);
    expect(h.anim.playing).toBe(true);

    driveToCompletion(h, 50);
    expect(h.stages).toEqual(['elevation', 'biomes', 'done', 'elevation', 'moisture', 'biomes', 'done']);
    const draws = h.calls.filter((c) => c.kind === 'draw');
    expect(draws).toEqual([
      { kind: 'draw', mode: 'elevation' },
      { kind: 'draw', mode: 'biomes' },
      { kind: 'draw', mode: 'elevation' },
      { kind: 'draw', mode: 'biomes' },
    ]);
    await expect(first).resolves.toBe('done');
    await expect(second).resolves.toBe('done');
  });

  it('config is isolated: stageMs 500 / transitionMs 100 → ~1200 ms total (test 7)', async () => {
    const h = createHarness({ config: { stageMs: 500, transitionMs: 100 } });
    const finished = h.anim.play();
    const total = driveToCompletion(h, 25);
    expect(total).toBeGreaterThanOrEqual(1150);
    expect(total).toBeLessThanOrEqual(1250);
    expect(h.stages).toEqual(['elevation', 'moisture', 'biomes', 'done']);
    await expect(finished).resolves.toBe('done');
  });

  it('skip during the elevation hold announces only biomes + done — skipped names are not replayed', async () => {
    const h = createHarness();
    const finished = h.anim.play();
    for (let i = 0; i < 4; i++) h.step(50); // clock 200 — before fade 1
    h.anim.skip();
    expect(h.calls).toEqual([
      { kind: 'draw', mode: 'elevation' },
      { kind: 'draw', mode: 'biomes' },
    ]);
    expect(h.stages).toEqual(['elevation', 'biomes', 'done']);
    await expect(finished).resolves.toBe('done');
  });

  it('onStageChange unsubscribe stops announcements', () => {
    const h = createHarness();
    h.unsubscribe();
    const finished = h.anim.play();
    driveToCompletion(h, 100);
    expect(h.stages).toEqual([]);
    expect(h.anim.currentStage).toBe('done'); // internal tracking unaffected
    return expect(finished).resolves.toBe('done');
  });

  it('dispose hard-stops without drawing and settles the pending promise', async () => {
    const h = createHarness();
    const finished = h.anim.play();
    h.step(50);
    h.anim.dispose();
    const callsAtDispose = h.calls.length;
    const reachedBiomes = h.calls.some(
      (c) => (c.kind === 'draw' && c.mode === 'biomes') || (c.kind === 'crossfade' && c.to === 'biomes'),
    );
    expect(reachedBiomes).toBe(false);
    expect(h.anim.playing).toBe(false);
    expect(h.anim.currentStage).toBeNull();
    expect(h.pendingFrames()).toBe(0);
    h.step(50);
    h.step(50);
    expect(h.calls.length).toBe(callsAtDispose);
    // Resolves 'done' by contract so awaits never dangle (documented on dispose()).
    await expect(finished).resolves.toBe('done');
  });

  // ---- T16-fix (F1): settle BEFORE the terminal 'done' announcement -------
  // The control panel refreshes Skip enablement on every stage event by
  // reading `playing`; before the fix, tick()/skip() announced 'done' while
  // the run was still live, so the last refresh saw playing === true and the
  // button stayed enabled with a dead click target.

  it('T16-fix F1: playing is already false when the done announcement fires (normal completion)', async () => {
    const h = createHarness();
    const playingAt = new Map<AnimationStage, boolean>();
    const unsubscribe = h.anim.onStageChange((stage) => playingAt.set(stage, h.anim.playing));
    const finished = h.anim.play();

    driveToCompletion(h, 50);

    expect(playingAt.get('elevation')).toBe(true); // enabled during playback
    expect(playingAt.get('moisture')).toBe(true);
    expect(playingAt.get('biomes')).toBe(true);
    expect(playingAt.get('done')).toBe(false); // settled before the terminal announce
    // The aria-live 'done' announcement still fires exactly once.
    expect(h.stages.filter((s) => s === 'done')).toHaveLength(1);
    expect(h.anim.playing).toBe(false);
    unsubscribe();
    await expect(finished).resolves.toBe('done');
  });

  it('T16-fix F1: playing is already false when the done announcement fires (user skip)', async () => {
    const h = createHarness();
    const playingAt = new Map<AnimationStage, boolean>();
    const unsubscribe = h.anim.onStageChange((stage) => playingAt.set(stage, h.anim.playing));
    const finished = h.anim.play();
    for (let i = 0; i < 21; i++) h.step(50); // clock 1050 — inside fade 1

    h.anim.skip();

    expect(playingAt.get('elevation')).toBe(true);
    expect(playingAt.get('done')).toBe(false); // settled before the terminal announce
    expect(h.stages.filter((s) => s === 'done')).toHaveLength(1);
    expect(h.anim.playing).toBe(false);
    unsubscribe();
    await expect(finished).resolves.toBe('done');
  });

  it('T16-fix F1: reduced motion never reports playing during any announcement (Skip disabled from the start)', async () => {
    const h = createHarness({ reducedMotion: true });
    const playingAt = new Map<AnimationStage, boolean>();
    const unsubscribe = h.anim.onStageChange((stage) => playingAt.set(stage, h.anim.playing));

    const finished = h.anim.play();

    expect(playingAt.get('biomes')).toBe(false);
    expect(playingAt.get('done')).toBe(false);
    expect(h.stages).toEqual(['biomes', 'done']); // exactly one 'done', as ever
    unsubscribe();
    await expect(finished).resolves.toBe('done');
  });
});
