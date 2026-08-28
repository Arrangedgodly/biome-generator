/**
 * Shared wire format between the main thread (MapWorkerClient) and the map
 * worker (handleWorkerMessage). Types only — no logic on either side may
 * depend on anything beyond this contract.
 *
 * D5 invariants carried by every response that includes buffers:
 * - each response owns freshly allocated buffers (never recycled), and
 * - the worker never reads or writes a buffer after posting it (the transfer
 *   list detaches it; treat it as dead from the post onward).
 */
import type { FieldParams } from '../generation/index.ts';

export type WorkerRequest =
  | { type: 'generate'; requestId: number; seed: number; params: FieldParams; resolution: number }
  | { type: 'recompute-elevation'; requestId: number; seed: number; params: FieldParams; resolution: number };

export type WorkerResponse =
  | { type: 'fields'; requestId: number; elevation: Float32Array; moisture: Float32Array; resolution: number }
  | { type: 'elevation'; requestId: number; elevation: Float32Array; resolution: number }
  | { type: 'error'; requestId: number; message: string };
