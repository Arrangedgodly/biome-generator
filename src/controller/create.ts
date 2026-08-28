/**
 * Production wiring for the update controller (T6): the real worker client
 * over the D4-recommended inline worker pattern + the real DOM renderer.
 *
 * `new Worker(new URL('../worker/map.worker.ts', import.meta.url), { type:
 * 'module' })` must stay inline exactly as written — Vite statically detects
 * this expression to emit the worker chunk (bundled iife per D5's pinned
 * `worker.format`). `workerFactory` remains injectable for T10's retry path
 * (terminate + create a NEW worker/client, D5) and for tests.
 */
import { MapWorkerClient } from '../worker/client.ts';
import { MapRenderer } from '../render/renderer.ts';
import { MapController } from './map-controller.ts';

/**
 * Production bundle returned by `createMapController`. T10 (additive change):
 * the renderer is exposed alongside the controller so `src/app.ts` can build a
 * `StagedAnimation` over it and re-create the whole stack on retry.
 *
 * T16-fix (F2): the worker client is deliberately NOT part of the bundle — it
 * is wired internally through the controller's `onDispose` hook, so
 * `controller.dispose()` terminates the worker thread. Before this, every
 * retry/rebuild (`app.ts` `rebuild()`) stranded one live worker because the
 * only reference owning `terminate()` was discarded here. The public shape is
 * unchanged.
 */
export interface MapControllerBundle {
  controller: MapController;
  renderer: MapRenderer;
}

export function createMapController(
  canvas: HTMLCanvasElement,
  workerFactory?: () => Worker,
): MapControllerBundle {
  const factory: () => Worker =
    workerFactory ??
    (() => new Worker(new URL('../worker/map.worker.ts', import.meta.url), { type: 'module' }));
  const client = new MapWorkerClient(factory);
  const renderer = new MapRenderer(canvas);
  const controller = new MapController({
    worker: client,
    renderer,
    // T16-fix (F2): dispose() fully releases this stack — terminate the
    // worker (rejects in-flight requests with WorkerCrashError, absorbed by
    // the controller's disposed guards).
    onDispose: () => client.terminate(),
  });
  return { controller, renderer };
}
