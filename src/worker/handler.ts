/**
 * Pure worker-message handler: the entire worker protocol minus the worker
 * plumbing. Takes an untrusted message and an injected `post` sink, so it is
 * fully unit-testable in Node with no real Worker.
 *
 * Guarantees:
 * - never throws out (invalid input and dispatch-time throws both become
 *   typed `error` responses);
 * - every successful response carries freshly allocated buffers in its
 *   transfer list, and this side never touches a buffer after posting it
 *   (D5 detach invariant — fresh by construction, one allocation per request).
 */
import { generateElevation, generateFields } from '../generation/fields.ts';
import type { FieldParams } from '../generation/index.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

/** Sink for worker responses: the message plus the buffers it transfers. */
export type PostResponse = (message: WorkerResponse, transfer: Transferable[]) => void;

/**
 * requestId echoed on error responses for requests whose own requestId could
 * not be read (missing / non-numeric). The client ignores responses whose id
 * is not pending, so this sentinel can never collide with a live request.
 */
export const INVALID_REQUEST_ID = -1;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

type Validated =
  | { valid: true; request: WorkerRequest }
  | { valid: false; requestId: number; message: string };

/**
 * Validates a message against the protocol. Shallow on `params` by design:
 * once params is an object it is passed through — garbage numerics propagate
 * to NaN fields (data, not exceptions), which the error path reports if the
 * pipeline ever does throw.
 */
function validateRequest(msg: unknown): Validated {
  if (!isRecord(msg)) {
    return {
      valid: false,
      requestId: INVALID_REQUEST_ID,
      message: `malformed request: expected an object, got ${typeof msg}`,
    };
  }
  if (msg.type !== 'generate' && msg.type !== 'recompute-elevation') {
    return {
      valid: false,
      requestId: INVALID_REQUEST_ID,
      message: `unknown request type: ${String(msg.type)}`,
    };
  }
  const type = msg.type;
  const rawRequestId = msg.requestId;
  if (!isFiniteNumber(rawRequestId)) {
    return {
      valid: false,
      requestId: INVALID_REQUEST_ID,
      message: 'missing or non-numeric requestId',
    };
  }
  const requestId = rawRequestId;
  const seed = msg.seed;
  if (!isFiniteNumber(seed)) {
    return { valid: false, requestId, message: 'missing or non-numeric seed' };
  }
  const resolution = msg.resolution;
  if (!isFiniteNumber(resolution)) {
    return { valid: false, requestId, message: 'missing or non-numeric resolution' };
  }
  if (!isRecord(msg.params)) {
    return { valid: false, requestId, message: 'missing or invalid params object' };
  }
  // Object-shaped params are trusted from here; the pipeline owns the numerics.
  const params = msg.params as unknown as FieldParams;
  return { valid: true, request: { type, requestId, seed, params, resolution } };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function handleWorkerMessage(msg: unknown, post: PostResponse): void {
  const validated = validateRequest(msg);
  if (!validated.valid) {
    post({ type: 'error', requestId: validated.requestId, message: validated.message }, []);
    return;
  }
  const { type, requestId, seed, params, resolution } = validated.request;
  try {
    if (type === 'generate') {
      const fields = generateFields(seed, params, resolution);
      // Ownership of both buffers transfers with this post; from here on the
      // worker treats them as detached memory it must never touch again (D5).
      post(
        {
          type: 'fields',
          requestId,
          elevation: fields.elevation,
          moisture: fields.moisture,
          resolution,
        },
        [fields.elevation.buffer, fields.moisture.buffer],
      );
    } else {
      const elevation = generateElevation(seed, params, resolution);
      post({ type: 'elevation', requestId, elevation, resolution }, [elevation.buffer]);
    }
  } catch (err) {
    post({ type: 'error', requestId, message: errorMessage(err) }, []);
  }
}
