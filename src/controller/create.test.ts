// @vitest-environment happy-dom
//
// T16-fix (F2) wiring tests for `createMapController`: dispose() must fully
// release the stack — terminate the worker client's underlying Worker (before
// the fix, the only reference owning `terminate()` was discarded inside
// `createMapController`, so every retry/rebuild stranded one live worker
// thread). The worker factory is instrumented (FakeWorker + counting factory,
// the same pattern as worker/client.test.ts); the canvas 2d context is mocked
// at the prototype level (happy-dom implements no canvas rasterizer, and the
// dispose paths under test never compose pixels).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMapController } from './create.ts';
import type { ControllerEvent } from './map-controller.ts';
import type { WorkerRequest } from '../worker/protocol.ts';

/** Structural Worker stand-in (client.test.ts pattern): records posts + termination. */
class FakeWorker {
  readonly posted: WorkerRequest[] = [];
  terminated = false;
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const existing = this.listeners.get(type);
    if (existing) existing.push(listener);
    else this.listeners.set(type, [listener]);
  }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Counting factory: every worker ever constructed is retained for inspection. */
function makeCountingFactory(): { factory: () => Worker; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  return {
    factory: () => {
      const fake = new FakeWorker();
      workers.push(fake);
      return fake as unknown as Worker;
    },
    workers,
  };
}

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  return canvas;
}

/** Minimal 2d-context double: the constructor path only toggles one flag. */
const fakeCtx = { imageSmoothingEnabled: true } as CanvasRenderingContext2D;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createMapController (T16-fix F2: dispose terminates the worker)', () => {
  it('controller.dispose() terminates the underlying worker', () => {
    const getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(fakeCtx);
    const { factory, workers } = makeCountingFactory();

    const { controller } = createMapController(makeCanvas(), factory);
    expect(workers).toHaveLength(1); // exactly one worker per construction
    expect(workers[0].terminated).toBe(false);
    expect(getContextSpy).toHaveBeenCalled(); // the real MapRenderer was built

    controller.dispose();

    expect(workers[0].terminated).toBe(true); // the client's terminate() ran
  });

  it('repeated construct→dispose cycles keep live-worker count at zero (5 cycles → 5 workers, all terminated)', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
    const { factory, workers } = makeCountingFactory();

    for (let i = 0; i < 5; i++) {
      const bundle = createMapController(makeCanvas(), factory);
      bundle.controller.dispose();
    }

    const alive = workers.filter((w) => !w.terminated);
    expect(workers).toHaveLength(5); // exactly 5 creations, no extras
    expect(alive).toHaveLength(0); // zero leaked live workers — count stays constant
  });

  it('dispose while a generate is pending: worker terminated, no error events, no unhandled rejections', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
    const { factory, workers } = makeCountingFactory();
    const { controller } = createMapController(makeCanvas(), factory);
    const events: ControllerEvent[] = [];
    controller.subscribe((e) => events.push(e));

    controller.regenerate(7); // FakeWorker never answers → the request stays pending
    expect(workers[0].posted).toHaveLength(1);
    expect(workers[0].posted[0].type).toBe('generate');
    const eventsBeforeDispose = events.length; // the seed-carrying state event
    expect(eventsBeforeDispose).toBe(1);

    controller.dispose();

    expect(workers[0].terminated).toBe(true);
    expect(workers[0].posted).toHaveLength(1); // nothing further was posted

    // Drain microtasks (+ one macrotask): the WorkerCrashError rejections that
    // terminate() raises on the in-flight request reach the controller's
    // disposed-guarded catches and surface NOTHING. Vitest fails the run on
    // any unhandled rejection, so this test passing is itself the
    // no-unhandled-rejection proof.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();

    expect(events).toHaveLength(eventsBeforeDispose); // no error/fields/anything after dispose
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
  });
});
