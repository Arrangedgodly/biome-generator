// URL-hash state tests (plan T13). Node env: the module is pure and every
// effect goes through injected ports — FakeLocation (records replaceState
// urls, exposes no pushState at all) and FakeScheduler (a cancellable queue
// of timers we fire by hand). No DOM, no real history, no real timers.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARED_STATE,
  SEED_MAX,
  STATE_VERSION,
  createUrlStateWriter,
  parseHashBody,
  readStateFromLocation,
  serializeState,
  writeStateToLocation,
} from './urlState.ts';
import type { LocationPort, SharedState } from './urlState.ts';

class FakeLocation implements LocationPort {
  hash: string;
  readonly urls: string[] = [];

  constructor(hash = '') {
    this.hash = hash;
  }

  replaceState(url: string): void {
    this.urls.push(url);
  }
}

interface ScheduledTimer {
  fn: () => void;
  ms: number;
  handle: number;
  cancelled: boolean;
}

class FakeScheduler {
  readonly queue: ScheduledTimer[] = [];
  readonly cancelled: number[] = [];
  private nextHandle = 1;

  schedule(fn: () => void, ms: number): number {
    const timer: ScheduledTimer = { fn, ms, handle: this.nextHandle++, cancelled: false };
    this.queue.push(timer);
    return timer.handle;
  }

  cancel(handle: number): void {
    this.cancelled.push(handle);
    const timer = this.queue.find((t) => t.handle === handle);
    if (timer) timer.cancelled = true;
  }

  /** Fire the oldest timer; cancelled timers are inert. */
  fireNext(): void {
    const timer = this.queue.shift();
    if (timer && !timer.cancelled) timer.fn();
  }

  get liveCount(): number {
    return this.queue.filter((t) => !t.cancelled).length;
  }
}

function wireWriter(loc: FakeLocation, scheduler: FakeScheduler) {
  return createUrlStateWriter(loc, {
    schedule: (fn, ms) => scheduler.schedule(fn, ms),
    cancel: (handle) => scheduler.cancel(handle as number),
  });
}

describe('urlState (T13)', () => {
  it('round-trips serialize → parseHashBody for slider-exact states', () => {
    const states: SharedState[] = [
      DEFAULT_SHARED_STATE,
      { version: STATE_VERSION, seed: 999999, elevation: 0, moisture: 0, preset: null },
      { version: STATE_VERSION, seed: 42, elevation: 1, moisture: 1, preset: 'continent' },
      { version: STATE_VERSION, seed: 7, elevation: 0.37, moisture: 0.82, preset: 'archipelago' },
    ];
    for (const state of states) {
      expect(parseHashBody(serializeState(state))).toEqual(state);
    }
  });

  it('serializes the canonical compact body; null preset omits the key; no leading #', () => {
    const canonical: SharedState = {
      version: STATE_VERSION,
      seed: 42,
      elevation: 0.5,
      moisture: 0.75,
      preset: 'continent',
    };
    expect(serializeState(canonical)).toBe('v=1&seed=42&el=0.5&mo=0.75&preset=continent');

    const noPreset: SharedState = {
      version: STATE_VERSION,
      seed: 0,
      elevation: 0.5,
      moisture: 0.5,
      preset: null,
    };
    const body = serializeState(noPreset);
    expect(body).toBe('v=1&seed=0&el=0.5&mo=0.5');
    expect(body.includes('preset')).toBe(false);
    expect(body.startsWith('#')).toBe(false);
  });

  it('serializes the seed into [0, SEED_MAX] — the wire can never leave the domain (hardening)', () => {
    // Negative seeds must not render one map and serialize another.
    const negative: SharedState = {
      version: STATE_VERSION,
      seed: -5,
      elevation: 0.5,
      moisture: 0.5,
      preset: null,
    };
    expect(serializeState(negative)).toBe('v=1&seed=0&el=0.5&mo=0.5');
    // Out-of-domain magnitudes clamp instead of writing a value the next
    // parse would reject (Infinity) or silently change (huge floats).
    const huge: SharedState = {
      version: STATE_VERSION,
      seed: 1e30,
      elevation: 0.5,
      moisture: 0.5,
      preset: null,
    };
    expect(serializeState(huge)).toBe(`v=1&seed=${SEED_MAX}&el=0.5&mo=0.5`);
  });

  it('returns DEFAULT_SHARED_STATE (never throws) for malformed bodies', () => {
    const malformed = ['', '   ', 'garbage', 'v=2&seed=1', 'v=1&seed=abc', 'seed=1&el=0.5&mo=0.5'];
    for (const body of malformed) {
      expect(() => parseHashBody(body)).not.toThrow();
      expect(parseHashBody(body)).toEqual(DEFAULT_SHARED_STATE);
    }
  });

  it('sanitizes out-of-range values instead of defaulting (clamp / floor / preset null)', () => {
    expect(() => {
      expect(parseHashBody('v=1&el=9&mo=-4')).toEqual({
        version: STATE_VERSION,
        seed: 0,
        elevation: 1,
        moisture: 0,
        preset: null,
      });
      expect(parseHashBody('v=1&seed=-5')).toEqual(DEFAULT_SHARED_STATE); // → default seed 0
      expect(parseHashBody('v=1&preset=EVIL!%20injection')).toEqual(DEFAULT_SHARED_STATE); // → preset null
      expect(parseHashBody('v=1&seed=3.7')).toEqual({
        version: STATE_VERSION,
        seed: 3,
        elevation: 0.5,
        moisture: 0.5,
        preset: null,
      });
    }).not.toThrow();
  });

  it('readStateFromLocation: no usable hash → null; usable body → parsed state', () => {
    expect(readStateFromLocation(new FakeLocation(''))).toBeNull();
    expect(readStateFromLocation(new FakeLocation('#'))).toBeNull();
    expect(readStateFromLocation(new FakeLocation('#v=1&seed=5'))).toEqual({
      version: STATE_VERSION,
      seed: 5,
      elevation: 0.5,
      moisture: 0.5,
      preset: null,
    });
  });

  it('writeStateToLocation: one replaceState with the hash form, no history entry', () => {
    const loc = new FakeLocation('#v=1&seed=1');
    const state: SharedState = {
      version: STATE_VERSION,
      seed: 9,
      elevation: 0.62,
      moisture: 0.48,
      preset: 'highlands',
    };
    writeStateToLocation(loc, state);
    const body = serializeState(state);
    expect(loc.urls).toHaveLength(1); // replaceState only — the fake has no pushState to call
    expect(loc.urls[0]).toBe(`#${body}`);
    expect(loc.urls[0].endsWith(body)).toBe(true);
  });

  it('coalesces a burst of pushes into one trailing write of the LAST state', () => {
    const loc = new FakeLocation();
    const scheduler = new FakeScheduler();
    const writer = wireWriter(loc, scheduler);
    const states: SharedState[] = [
      { version: STATE_VERSION, seed: 1, elevation: 0.1, moisture: 0.1, preset: null },
      { version: STATE_VERSION, seed: 2, elevation: 0.2, moisture: 0.2, preset: null },
      { version: STATE_VERSION, seed: 3, elevation: 0.3, moisture: 0.3, preset: null },
      { version: STATE_VERSION, seed: 4, elevation: 0.4, moisture: 0.4, preset: null },
      { version: STATE_VERSION, seed: 5, elevation: 0.5, moisture: 0.5, preset: 'archipelago' },
    ];
    for (const state of states) writer.push(state);

    expect(scheduler.queue).toHaveLength(1); // 5 pushes, ONE timer
    expect(scheduler.queue[0].ms).toBe(200); // default delayMs
    expect(loc.urls).toEqual([]); // not yet written

    scheduler.fireNext();
    expect(loc.urls).toEqual([`#${serializeState(states[4])}`]); // last state, exactly once
    expect(scheduler.liveCount).toBe(0);
  });

  it('flush(): no-op when nothing pending; push+flush writes now and cancels the timer', () => {
    const loc = new FakeLocation();
    const scheduler = new FakeScheduler();
    const writer = wireWriter(loc, scheduler);

    writer.flush();
    expect(loc.urls).toEqual([]);
    expect(scheduler.cancelled).toEqual([]);

    const state: SharedState = {
      version: STATE_VERSION,
      seed: 31,
      elevation: 0.25,
      moisture: 0.75,
      preset: null,
    };
    writer.push(state);
    expect(scheduler.queue).toHaveLength(1);

    writer.flush();
    expect(loc.urls).toEqual([`#${serializeState(state)}`]); // written NOW
    expect(scheduler.cancelled).toHaveLength(1); // timer cancelled

    scheduler.fireNext(); // a late fire of the cancelled timer must not write again
    expect(loc.urls).toHaveLength(1);
  });

  it('DEFAULT_SHARED_STATE sanity: version 1, seed 0, centered sliders, no preset', () => {
    expect(DEFAULT_SHARED_STATE).toEqual({
      version: 1,
      seed: 0,
      elevation: 0.5,
      moisture: 0.5,
      preset: null,
    });
    expect(DEFAULT_SHARED_STATE.version).toBe(STATE_VERSION);
  });
});
