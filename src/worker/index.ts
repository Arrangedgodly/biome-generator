/**
 * Public API of the worker layer: wire types, the pure handler, and the
 * main-thread client.
 */
export { handleWorkerMessage, INVALID_REQUEST_ID } from './handler.ts';
export type { PostResponse } from './handler.ts';
export {
  DetachedBufferError,
  MapWorkerClient,
  SupersededError,
  WorkerCrashError,
} from './client.ts';
export type { WorkerRequest, WorkerResponse } from './protocol.ts';
/**
 * URL of the bundled worker asset. This re-export is also what makes
 * `vite build` emit the separate worker chunk (pinned to `worker.format:
 * 'iife'`, D5) — T6/T10 instantiate it with the classic
 * `new Worker(mapWorkerUrl)` constructor. No runtime behavior lives here.
 */
export { default as mapWorkerUrl } from './map.worker.ts?worker&url';
