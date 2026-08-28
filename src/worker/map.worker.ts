/**
 * Map worker entry — the only file that runs inside the worker scope.
 *
 * Kept deliberately thin so all protocol logic stays in the pure, Node-tested
 * `handleWorkerMessage`. D5 constraints honored here: the bundle is classic /
 * iife-compatible (no dynamic imports, no DOM APIs — everything it pulls in is
 * pure noise/field math).
 */
import { handleWorkerMessage } from './handler.ts';
import type { WorkerResponse } from './protocol.ts';

/**
 * `lib.dom` types the global `self` as `Window`, whose `postMessage` signature
 * (targetOrigin / options) differs from the dedicated-worker global scope. In
 * the emitted worker bundle `self` is the DedicatedWorkerGlobalScope, whose
 * classic `postMessage(message, transfer)` call is exactly what we model here.
 */
interface WorkerScopeSlice {
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const workerScope = self as unknown as WorkerScopeSlice;

workerScope.onmessage = (event: MessageEvent) => {
  handleWorkerMessage(event.data, (message, transfer) => {
    // Posting transfers ownership of every buffer in `transfer`; neither the
    // handler nor this scope reads or writes them afterwards (D5).
    workerScope.postMessage(message, transfer);
  });
};
