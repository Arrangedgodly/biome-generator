/**
 * Main-thread client for the map worker. Owns request/response correlation,
 * per-channel latest-wins superseding, and the D5 detach guards on every
 * arriving buffer.
 *
 * The Worker instance is injected (`workerFactory`) so tests can drive the
 * full client against a fake worker in Node. Retry policy (terminate + create
 * a NEW worker/client — never reuse a terminated one, D5) belongs to the
 * caller (T10); `terminate()` here rejects everything still pending.
 */
import type { FieldParams, Fields } from '../generation/index.ts';
import type { WorkerRequest } from './protocol.ts';

/** The pending request was superseded by a newer request on the same channel. */
export class SupersededError extends Error {
  constructor() {
    super('superseded by a newer request');
    this.name = 'SupersededError';
  }
}

/** The worker errored, was terminated, or answered outside the protocol. */
export class WorkerCrashError extends Error {
  constructor(message = 'map worker crashed') {
    super(message);
    this.name = 'WorkerCrashError';
  }
}

/** A response buffer arrived detached (byteLength 0) or with the wrong size. */
export class DetachedBufferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetachedBufferError';
  }
}

/** Two independent request channels: full generation and elevation recompute. */
type Channel = 'generate' | 'elevation';

type PendingOutcome =
  | { expected: 'fields'; resolve: (fields: Fields) => void; reject: (err: Error) => void }
  | { expected: 'elevation'; resolve: (elevation: Float32Array) => void; reject: (err: Error) => void };

interface PendingEntry {
  channel: Channel;
  resolution: number;
  /** resolution² × 4 bytes — the byteLength every arriving buffer must have. */
  expectedBytes: number;
  outcome: PendingOutcome;
}

export class MapWorkerClient {
  private readonly worker: Worker;
  private nextRequestId = 0;
  private readonly pending = new Map<number, PendingEntry>();
  private readonly activeByChannel = new Map<Channel, number>();

  constructor(workerFactory: () => Worker) {
    this.worker = workerFactory();
    this.worker.addEventListener('message', (event) => this.handleResponse(event.data));
    this.worker.addEventListener('error', () =>
      this.rejectAllPending(new WorkerCrashError('map worker raised an error event')),
    );
    this.worker.addEventListener('messageerror', () =>
      this.rejectAllPending(new WorkerCrashError('map worker raised a messageerror event')),
    );
  }

  /** Full field generation (elevation + moisture). Supersedes a pending generate. */
  generate(seed: number, params: FieldParams, resolution: number): Promise<Fields> {
    return new Promise<Fields>((resolve, reject) => {
      this.send(
        'generate',
        resolution,
        { expected: 'fields', resolve, reject },
        (requestId) => ({ type: 'generate', requestId, seed, params, resolution }),
      );
    });
  }

  /** Elevation-only recompute. Supersedes a pending recompute, never a generate. */
  recomputeElevation(seed: number, params: FieldParams, resolution: number): Promise<Float32Array> {
    return new Promise<Float32Array>((resolve, reject) => {
      this.send(
        'elevation',
        resolution,
        { expected: 'elevation', resolve, reject },
        (requestId) => ({ type: 'recompute-elevation', requestId, seed, params, resolution }),
      );
    });
  }

  /** Kills the worker and rejects everything still pending with WorkerCrashError. */
  terminate(): void {
    this.worker.terminate();
    this.rejectAllPending(new WorkerCrashError('map worker was terminated'));
  }

  private send(
    channel: Channel,
    resolution: number,
    outcome: PendingOutcome,
    buildRequest: (requestId: number) => WorkerRequest,
  ): void {
    const requestId = ++this.nextRequestId;

    // Latest-wins: a new request on an occupied channel immediately rejects
    // the previous one; its eventual response finds no pending entry and is
    // dropped silently on arrival.
    const previousId = this.activeByChannel.get(channel);
    if (previousId !== undefined) {
      const previous = this.pending.get(previousId);
      if (previous !== undefined) {
        this.pending.delete(previousId);
        previous.outcome.reject(new SupersededError());
      }
    }

    this.activeByChannel.set(channel, requestId);
    this.pending.set(requestId, {
      channel,
      resolution,
      expectedBytes: resolution * resolution * 4,
      outcome,
    });
    this.worker.postMessage(buildRequest(requestId));
  }

  private handleResponse(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const response = data as Record<string, unknown>;
    const requestId = response.requestId;
    if (typeof requestId !== 'number' || !Number.isFinite(requestId)) return;

    const entry = this.pending.get(requestId);
    if (entry === undefined) return; // stale (superseded or settled): ignore silently
    const outcome = entry.outcome;

    if (response.type === 'error') {
      const message =
        typeof response.message === 'string' ? response.message : 'map worker reported an unknown error';
      this.finishEntry(requestId, entry);
      outcome.reject(new Error(message));
      return;
    }

    if (response.type === 'elevation') {
      if (outcome.expected !== 'elevation') {
        this.finishEntry(requestId, entry);
        outcome.reject(
          new WorkerCrashError('protocol violation: expected a fields response, got elevation'),
        );
        return;
      }
      if (!isValidBuffer(response.elevation, entry.expectedBytes)) {
        this.finishEntry(requestId, entry);
        outcome.reject(bufferError('elevation', response.elevation, entry.expectedBytes));
        return;
      }
      this.finishEntry(requestId, entry);
      outcome.resolve(response.elevation);
      return;
    }

    if (response.type === 'fields') {
      if (outcome.expected !== 'fields') {
        this.finishEntry(requestId, entry);
        outcome.reject(
          new WorkerCrashError('protocol violation: expected an elevation response, got fields'),
        );
        return;
      }
      if (!isValidBuffer(response.elevation, entry.expectedBytes)) {
        this.finishEntry(requestId, entry);
        outcome.reject(bufferError('elevation', response.elevation, entry.expectedBytes));
        return;
      }
      if (!isValidBuffer(response.moisture, entry.expectedBytes)) {
        this.finishEntry(requestId, entry);
        outcome.reject(bufferError('moisture', response.moisture, entry.expectedBytes));
        return;
      }
      this.finishEntry(requestId, entry);
      outcome.resolve({
        elevation: response.elevation,
        moisture: response.moisture,
        resolution: entry.resolution,
      });
      return;
    }

    // Unknown response type on a live request: the worker is misbehaving.
    this.finishEntry(requestId, entry);
    outcome.reject(new WorkerCrashError(`unknown response type: ${String(response.type)}`));
  }

  private finishEntry(requestId: number, entry: PendingEntry): void {
    this.pending.delete(requestId);
    if (this.activeByChannel.get(entry.channel) === requestId) {
      this.activeByChannel.delete(entry.channel);
    }
  }

  private rejectAllPending(error: WorkerCrashError): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    this.activeByChannel.clear();
    for (const entry of entries) {
      entry.outcome.reject(error);
    }
  }
}

/** D5 detach guard: a buffer must be a Float32Array of exactly resolution²×4 bytes. */
function isValidBuffer(value: unknown, expectedBytes: number): value is Float32Array {
  return value instanceof Float32Array && value.byteLength === expectedBytes;
}

function bufferError(name: string, value: unknown, expectedBytes: number): DetachedBufferError {
  const actual = value instanceof Float32Array ? `${value.byteLength} bytes` : 'not a Float32Array';
  return new DetachedBufferError(
    `${name} buffer is detached or has the wrong size (expected ${expectedBytes} bytes, got ${actual})`,
  );
}
