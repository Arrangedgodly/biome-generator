import { describe, it, expect } from 'vitest';
import {
  DetachedBufferError,
  MapWorkerClient,
  SupersededError,
  WorkerCrashError,
} from './client.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';
import { DEFAULT_FIELD_PARAMS } from '../generation/index.ts';

/**
 * Minimal Worker stand-in: records posted requests, lets tests fire
 * message/error/messageerror events by hand via `dispatch`, and flags
 * termination. No cast into the Worker interface is needed inside the class —
 * only at the injection point below.
 */
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

  /** Test hook: fire an event to every listener registered for `type`. */
  dispatch(type: 'message' | 'error' | 'messageerror', data?: unknown): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ data });
    }
  }
}

function makeClient(): { client: MapWorkerClient; fake: FakeWorker } {
  const fake = new FakeWorker();
  // Test-only structural stand-in: FakeWorker implements exactly the slice of
  // the DOM Worker interface that MapWorkerClient touches
  // (addEventListener / postMessage / terminate).
  const client = new MapWorkerClient(() => fake as unknown as Worker);
  return { client, fake };
}

function fieldsResponse(requestId: number, resolution: number): WorkerResponse {
  const n = resolution * resolution;
  return {
    type: 'fields',
    requestId,
    elevation: new Float32Array(n),
    moisture: new Float32Array(n),
    resolution,
  };
}

function elevationResponse(requestId: number, resolution: number): WorkerResponse {
  return {
    type: 'elevation',
    requestId,
    elevation: new Float32Array(resolution * resolution),
    resolution,
  };
}

describe('MapWorkerClient: happy paths', () => {
  it('generate posts a well-formed request and resolves Fields of the requested size', async () => {
    const { client, fake } = makeClient();
    const promise = client.generate(11, DEFAULT_FIELD_PARAMS, 64);

    expect(fake.posted.length).toBe(1);
    const request = fake.posted[0];
    expect(request.type).toBe('generate');
    expect(request.seed).toBe(11);
    expect(request.resolution).toBe(64);
    expect(request.requestId).toBeGreaterThan(0);

    fake.dispatch('message', fieldsResponse(request.requestId, 64));
    const fields = await promise;
    expect(fields.elevation.length).toBe(64 * 64);
    expect(fields.moisture.length).toBe(64 * 64);
    expect(fields.resolution).toBe(64);
  });
});

describe('MapWorkerClient: latest-wins superseding', () => {
  it('a second generate rejects the first with SupersededError, drops its late response, and resolves on the new one', async () => {
    const { client, fake } = makeClient();
    const first = client.generate(1, DEFAULT_FIELD_PARAMS, 32);
    // Attach the rejection expectation immediately so the supersede rejection
    // (fired synchronously by the next call) is never unhandled.
    const firstRejection = expect(first).rejects.toBeInstanceOf(SupersededError);
    const second = client.generate(2, DEFAULT_FIELD_PARAMS, 32);
    await firstRejection;

    expect(fake.posted.length).toBe(2);
    expect(fake.posted[1].requestId).toBeGreaterThan(fake.posted[0].requestId);

    // Late response for the superseded request: must be dropped silently —
    // the first promise is already settled, and nothing may throw.
    fake.dispatch('message', fieldsResponse(fake.posted[0].requestId, 32));

    // Response for the live request resolves it.
    fake.dispatch('message', fieldsResponse(fake.posted[1].requestId, 32));
    const fields = await second;
    expect(fields.resolution).toBe(32);
  });

  it('recompute has its own channel: superseding a recompute never touches a pending generate', async () => {
    const { client, fake } = makeClient();
    const generatePromise = client.generate(1, DEFAULT_FIELD_PARAMS, 32);
    const firstRecompute = client.recomputeElevation(2, DEFAULT_FIELD_PARAMS, 32);
    const firstRecomputeRejection = expect(firstRecompute).rejects.toBeInstanceOf(SupersededError);
    const secondRecompute = client.recomputeElevation(3, DEFAULT_FIELD_PARAMS, 32);
    await firstRecomputeRejection;

    // The generate request is unaffected: it still resolves normally.
    fake.dispatch('message', fieldsResponse(fake.posted[0].requestId, 32));
    const fields = await generatePromise;
    expect(fields.elevation.length).toBe(32 * 32);

    // And the surviving recompute resolves with its elevation buffer.
    fake.dispatch('message', elevationResponse(fake.posted[2].requestId, 32));
    const elevation = await secondRecompute;
    expect(elevation.length).toBe(32 * 32);
  });
});

describe('MapWorkerClient: error and detach paths', () => {
  it('rejects with the worker error message on an error response', async () => {
    const { client, fake } = makeClient();
    const promise = client.generate(5, DEFAULT_FIELD_PARAMS, 32);
    const request = fake.posted[0];
    fake.dispatch('message', { type: 'error', requestId: request.requestId, message: 'boom' });
    await expect(promise).rejects.toThrow('boom');
  });

  it('rejects with DetachedBufferError when an arriving buffer has byteLength 0', async () => {
    const { client, fake } = makeClient();
    const promise = client.recomputeElevation(6, DEFAULT_FIELD_PARAMS, 32);
    const request = fake.posted[0];
    fake.dispatch('message', {
      type: 'elevation',
      requestId: request.requestId,
      elevation: new Float32Array(0),
      resolution: 32,
    });
    await expect(promise).rejects.toBeInstanceOf(DetachedBufferError);
  });
});

describe('MapWorkerClient: crash and termination', () => {
  it('a worker error event rejects every pending request with WorkerCrashError', async () => {
    const { client, fake } = makeClient();
    const generatePromise = client.generate(7, DEFAULT_FIELD_PARAMS, 32);
    const generateRejection = expect(generatePromise).rejects.toBeInstanceOf(WorkerCrashError);
    const recomputePromise = client.recomputeElevation(8, DEFAULT_FIELD_PARAMS, 32);
    const recomputeRejection = expect(recomputePromise).rejects.toBeInstanceOf(WorkerCrashError);

    fake.dispatch('error');
    await generateRejection;
    await recomputeRejection;
  });

  it('terminate() flags the worker and rejects everything still pending with WorkerCrashError', async () => {
    const { client, fake } = makeClient();
    const promise = client.generate(9, DEFAULT_FIELD_PARAMS, 32);
    const rejection = expect(promise).rejects.toBeInstanceOf(WorkerCrashError);

    client.terminate();
    expect(fake.terminated).toBe(true);
    await rejection;
  });
});
