import { describe, it, expect } from 'vitest';
import { handleWorkerMessage, INVALID_REQUEST_ID } from './handler.ts';
import type { WorkerResponse } from './protocol.ts';
import { DEFAULT_FIELD_PARAMS, generateElevation, generateFields } from '../generation/fields.ts';

interface Posted {
  message: WorkerResponse;
  transfer: Transferable[];
}

function makePost(): { posted: Posted[]; post: (message: WorkerResponse, transfer: Transferable[]) => void } {
  const posted: Posted[] = [];
  return { posted, post: (message, transfer) => posted.push({ message, transfer }) };
}

function single(posted: Posted[]): Posted {
  expect(posted.length).toBe(1);
  return posted[0];
}

function expectFields(message: WorkerResponse): Extract<WorkerResponse, { type: 'fields' }> {
  if (message.type !== 'fields') throw new Error(`expected a fields response, got ${message.type}`);
  return message;
}

function expectElevation(message: WorkerResponse): Extract<WorkerResponse, { type: 'elevation' }> {
  if (message.type !== 'elevation') throw new Error(`expected an elevation response, got ${message.type}`);
  return message;
}

function expectError(message: WorkerResponse): Extract<WorkerResponse, { type: 'error' }> {
  if (message.type !== 'error') throw new Error(`expected an error response, got ${message.type}`);
  return message;
}

function expectElementWiseEqual(actual: Float32Array, expected: Float32Array): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBe(expected[i]);
  }
}

describe('handleWorkerMessage: generate', () => {
  it('posts a fields response at 128 with both buffers transferred and values matching a direct generateFields call', () => {
    const { posted, post } = makePost();
    expect(() =>
      handleWorkerMessage(
        { type: 'generate', requestId: 42, seed: 7, params: DEFAULT_FIELD_PARAMS, resolution: 128 },
        post,
      ),
    ).not.toThrow();

    const response = expectFields(single(posted).message);
    expect(response.requestId).toBe(42);
    expect(response.resolution).toBe(128);
    expect(response.elevation.length).toBe(128 * 128);
    expect(response.moisture.length).toBe(128 * 128);

    const { transfer } = single(posted);
    expect(transfer.length).toBe(2);
    expect(transfer[0]).toBe(response.elevation.buffer);
    expect(transfer[1]).toBe(response.moisture.buffer);

    // Determinism: the worker path must equal a direct pipeline call.
    const direct = generateFields(7, DEFAULT_FIELD_PARAMS, 128);
    expectElementWiseEqual(response.elevation, direct.elevation);
    expectElementWiseEqual(response.moisture, direct.moisture);
  });

  it('posts a 512² fields response with 262144-element buffers (production-resolution smoke)', () => {
    const { posted, post } = makePost();
    handleWorkerMessage(
      { type: 'generate', requestId: 1, seed: 2, params: DEFAULT_FIELD_PARAMS, resolution: 512 },
      post,
    );
    const response = expectFields(single(posted).message);
    expect(response.elevation.length).toBe(262144);
    expect(response.moisture.length).toBe(262144);
    expect(response.elevation.buffer.byteLength).toBe(262144 * 4);
    expect(single(posted).transfer.length).toBe(2);
  });
});

describe('handleWorkerMessage: recompute-elevation', () => {
  it('posts an elevation-only response at 96 with a single transfer, values matching a direct generateElevation call', () => {
    const { posted, post } = makePost();
    expect(() =>
      handleWorkerMessage(
        { type: 'recompute-elevation', requestId: 7, seed: 13, params: DEFAULT_FIELD_PARAMS, resolution: 96 },
        post,
      ),
    ).not.toThrow();

    const response = expectElevation(single(posted).message);
    expect(response.requestId).toBe(7);
    expect(response.resolution).toBe(96);
    expect(response.elevation.length).toBe(96 * 96);

    const { transfer } = single(posted);
    expect(transfer.length).toBe(1);
    expect(transfer[0]).toBe(response.elevation.buffer);

    const direct = generateElevation(13, DEFAULT_FIELD_PARAMS, 96);
    expectElementWiseEqual(response.elevation, direct);
  });
});

describe('handleWorkerMessage: invalid requests never throw', () => {
  it('responds with an error for an unknown request type', () => {
    const { posted, post } = makePost();
    expect(() =>
      handleWorkerMessage(
        { type: 'regenerate', requestId: 1, seed: 1, params: DEFAULT_FIELD_PARAMS, resolution: 16 },
        post,
      ),
    ).not.toThrow();
    const response = expectError(single(posted).message);
    expect(response.requestId).toBe(INVALID_REQUEST_ID);
    expect(response.message).toMatch(/type/i);
  });

  it('responds with an error for a missing requestId', () => {
    const { posted, post } = makePost();
    // requestId intentionally absent from the message.
    expect(() =>
      handleWorkerMessage(
        { type: 'generate', seed: 1, params: DEFAULT_FIELD_PARAMS, resolution: 16 },
        post,
      ),
    ).not.toThrow();
    const response = expectError(single(posted).message);
    expect(response.requestId).toBe(INVALID_REQUEST_ID);
    expect(response.message).toMatch(/requestId/i);
  });

  it('responds with an error for a non-numeric resolution', () => {
    const { posted, post } = makePost();
    expect(() =>
      handleWorkerMessage(
        { type: 'generate', requestId: 3, seed: 1, params: DEFAULT_FIELD_PARAMS, resolution: 'big' },
        post,
      ),
    ).not.toThrow();
    const response = expectError(single(posted).message);
    expect(response.requestId).toBe(3); // valid id is echoed even on validation failure
    expect(response.message).toMatch(/resolution/i);
  });

  it('responds with an error for null params', () => {
    const { posted, post } = makePost();
    expect(() =>
      handleWorkerMessage(
        { type: 'generate', requestId: 5, seed: 1, params: null, resolution: 16 },
        post,
      ),
    ).not.toThrow();
    const response = expectError(single(posted).message);
    expect(response.requestId).toBe(5);
    expect(response.message).toMatch(/params/i);
    expect(response.message.length).toBeGreaterThan(0);
  });
});

describe('handleWorkerMessage: dispatch-time throws become error responses', () => {
  it('reports a RangeError from an unallocatable resolution instead of throwing out', () => {
    const { posted, post } = makePost();
    // resolution 2²⁷ ⇒ pixel count 2⁵⁴, past the 2⁵³−1 typed-array length cap,
    // so allocation throws RangeError inside the pipeline — this exercises the
    // try/catch around dispatch (finite number, so it passes validation).
    expect(() =>
      handleWorkerMessage(
        { type: 'generate', requestId: 6, seed: 1, params: DEFAULT_FIELD_PARAMS, resolution: 2 ** 27 },
        post,
      ),
    ).not.toThrow();
    const response = expectError(single(posted).message);
    expect(response.requestId).toBe(6);
    expect(typeof response.message).toBe('string');
    expect(response.message.length).toBeGreaterThan(0);
    expect(response.message).toMatch(/array|length|allocation/i);
  });
});
