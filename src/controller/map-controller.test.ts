import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapController } from './map-controller.ts';
import type { ControllerEvent, RendererPort, WorkerPort } from './map-controller.ts';
import { SupersededError } from '../worker/client.ts';
import type { ClassifyBiases, FieldParams, Fields } from '../generation/index.ts';
import { DEFAULT_FIELD_PARAMS } from '../generation/index.ts';

/**
 * Node harness for the controller: fake-timer-driven debounce, manually
 * resolved deferreds standing in for the worker port, and call-logging port
 * doubles. No DOM, no real worker — the ports are the only seams.
 */

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolveFn!: (value: T) => void;
  private rejectFn!: (error: Error) => void;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
    });
  }

  resolve(value: T): void {
    this.resolveFn(value);
  }

  reject(error: Error): void {
    this.rejectFn(error);
  }
}

type GenerateCall = {
  method: 'generate';
  seed: number;
  params: FieldParams;
  resolution: number;
  deferred: Deferred<Fields>;
};

type RecomputeCall = {
  method: 'recomputeElevation';
  seed: number;
  params: FieldParams;
  resolution: number;
  deferred: Deferred<Float32Array>;
};

type FakeCall = GenerateCall | RecomputeCall;

class FakeWorkerPort implements WorkerPort {
  readonly calls: FakeCall[] = [];

  constructor(private readonly onCall?: () => void) {}

  generate(seed: number, params: FieldParams, resolution: number): Promise<Fields> {
    const deferred = new Deferred<Fields>();
    this.calls.push({ method: 'generate', seed, params, resolution, deferred });
    this.onCall?.();
    return deferred.promise;
  }

  recomputeElevation(
    seed: number,
    params: FieldParams,
    resolution: number,
  ): Promise<Float32Array> {
    const deferred = new Deferred<Float32Array>();
    this.calls.push({ method: 'recomputeElevation', seed, params, resolution, deferred });
    this.onCall?.();
    return deferred.promise;
  }

  get generateCalls(): GenerateCall[] {
    return this.calls.filter((c): c is GenerateCall => c.method === 'generate');
  }

  get recomputeCalls(): RecomputeCall[] {
    return this.calls.filter((c): c is RecomputeCall => c.method === 'recomputeElevation');
  }

  clear(): void {
    this.calls.length = 0;
  }
}

type RendererCall =
  | { op: 'setFields'; fields: Fields }
  | { op: 'rebuildBiomes'; biases: ClassifyBiases }
  | { op: 'draw'; mode: 'elevation' | 'moisture' | 'biomes' };

class FakeRendererPort implements RendererPort {
  readonly log: RendererCall[] = [];

  setFields(fields: Fields): void {
    this.log.push({ op: 'setFields', fields });
  }

  rebuildBiomes(biases: ClassifyBiases): void {
    this.log.push({ op: 'rebuildBiomes', biases });
  }

  draw(mode: 'elevation' | 'moisture' | 'biomes'): void {
    this.log.push({ op: 'draw', mode });
  }

  get setFieldsCalls(): Array<{ op: 'setFields'; fields: Fields }> {
    return this.log.filter((c): c is { op: 'setFields'; fields: Fields } => c.op === 'setFields');
  }

  clear(): void {
    this.log.length = 0;
  }
}

function makeController(onWorkerCall?: () => void): {
  controller: MapController;
  worker: FakeWorkerPort;
  renderer: FakeRendererPort;
  events: ControllerEvent[];
  unsubscribe: () => void;
} {
  const worker = new FakeWorkerPort(onWorkerCall);
  const renderer = new FakeRendererPort();
  const controller = new MapController({ worker, renderer });
  const events: ControllerEvent[] = [];
  const unsubscribe = controller.subscribe((e: ControllerEvent) => {
    events.push(e);
  });
  return { controller, worker, renderer, events, unsubscribe };
}

/** Fields whose arrays are identifiable by fill marker (identity + content). */
function filledFields(resolution: number, elevationMarker: number, moistureMarker: number): Fields {
  return {
    elevation: new Float32Array(resolution * resolution).fill(elevationMarker),
    moisture: new Float32Array(resolution * resolution).fill(moistureMarker),
    resolution,
  };
}

function filledElevation(resolution: number, marker: number): Float32Array {
  return new Float32Array(resolution * resolution).fill(marker);
}

/** Flush the microtask queue so resolved deferreds reach the controller. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Runs one full preview cycle for the current seed (cache miss → generate@256
 * → resolved + published) so later drags exercise the cache-HIT recompute
 * path. Returns the fields that were served as the preview.
 */
async function warmPreviewCache(
  controller: MapController,
  worker: FakeWorkerPort,
  elevation: number,
): Promise<Fields> {
  controller.setElevation(elevation);
  vi.advanceTimersByTime(40); // > default 30ms debounce → preview fires
  const call = worker.generateCalls.at(-1);
  if (call === undefined) throw new Error('warmPreviewCache: expected a cache-miss generate@256');
  const fields = filledFields(256, 0.5, 0.5);
  call.deferred.resolve(fields);
  await flush();
  return fields;
}

describe('MapController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts centered: default params, no biases, no fields', () => {
    const { controller } = makeController();
    expect(controller.state).toEqual({ seed: 0, elevation: 0.5, moisture: 0.5 });
    expect(controller.currentFields).toBeNull();
    expect(controller.fieldParams).toEqual(DEFAULT_FIELD_PARAMS);
    expect(controller.biases).toEqual({ seaLevelBias: 0, moistureBias: 0 });
  });

  describe('1. moisture slider: instant local reclassify', () => {
    it('never trips the worker; rebuilds biomes + draws; emits state; unsubscribes cleanly', () => {
      const { controller, worker, renderer, events, unsubscribe } = makeController();

      controller.setMoisture(0.9);

      // The worker must never be called for moisture changes.
      expect(worker.calls.length).toBe(0);

      // Renderer: local LUT rebuild + biome draw, nothing else.
      expect(renderer.log).toHaveLength(2);
      const rebuild = renderer.log[0];
      if (rebuild.op !== 'rebuildBiomes') throw new Error('expected rebuildBiomes first');
      expect(rebuild.biases.seaLevelBias).toBe(0);
      expect(rebuild.biases.moistureBias).toBeCloseTo(0.32, 10); // (0.9 − 0.5) × 0.8
      expect(renderer.log[1]).toEqual({ op: 'draw', mode: 'biomes' });
      expect(controller.biases.moistureBias).toBeCloseTo(0.32, 10);

      // State event reflects the requested value immediately.
      const states = events.filter((e): e is Extract<ControllerEvent, { type: 'state' }> => e.type === 'state');
      expect(states.at(-1)?.state.moisture).toBe(0.9);
      expect(events.some((e) => e.type === 'fields' || e.type === 'preview' || e.type === 'error')).toBe(
        false,
      );

      // Unsubscribe works: a later change produces no further events.
      const eventCount = events.length;
      unsubscribe();
      controller.setMoisture(0.1);
      expect(events.length).toBe(eventCount);
    });
  });

  describe('2. elevation drag: debounced 256² preview', () => {
    it('coalesces a rapid burst into exactly one recomputeElevation@256 with the last drag value', async () => {
      const { controller, worker, renderer, events } = makeController();
      // Warm the per-seed preview cache so the burst observes the cache-hit
      // recompute path (the very first drag is a cache-miss generate@256).
      await warmPreviewCache(controller, worker, 0.2);
      worker.clear();
      renderer.clear();
      events.length = 0;

      for (let i = 0; i < 6; i++) {
        controller.setElevation(0.1 + i * 0.05); // 0.10 … 0.35
        vi.advanceTimersByTime(5); // spacing well under the 30ms debounce
      }
      vi.advanceTimersByTime(30);

      // Exactly one worker request for the whole burst, on the elevation
      // channel, at preview resolution, carrying the LAST drag value's params.
      expect(worker.calls).toHaveLength(1);
      const call = worker.recomputeCalls[0];
      expect(call.method).toBe('recomputeElevation');
      expect(call.resolution).toBe(256);
      expect(call.seed).toBe(0);
      expect(call.params.elevationFreq).toBeCloseTo(2.5 + 2 * 0.35, 10);
      expect(call.params.redistribution).toBeCloseTo(1.2 + 0.6 * 0.35, 10);

      // On resolve the renderer receives the 256² preview fields and a
      // preview event fires.
      call.deferred.resolve(filledElevation(256, 0.42));
      await flush();
      const setFields = renderer.setFieldsCalls;
      expect(setFields.at(-1)?.fields.resolution).toBe(256);
      expect(setFields.at(-1)?.fields.elevation[0]).toBeCloseTo(0.42, 5); // Float32 marker
      const previews = events.filter(
        (e): e is Extract<ControllerEvent, { type: 'preview' }> => e.type === 'preview',
      );
      expect(previews.at(-1)?.fields.resolution).toBe(256);
    });

    it('maps the elevation slider onto terrain character (0.5 → defaults)', () => {
      const { controller } = makeController();
      expect(controller.fieldParams.elevationFreq).toBe(3.5);
      expect(controller.fieldParams.redistribution).toBe(1.5);

      controller.setElevation(0);
      expect(controller.fieldParams.elevationFreq).toBeCloseTo(2.5, 10);
      expect(controller.fieldParams.redistribution).toBeCloseTo(1.2, 10);

      controller.setElevation(1);
      expect(controller.fieldParams.elevationFreq).toBeCloseTo(4.5, 10);
      expect(controller.fieldParams.redistribution).toBeCloseTo(1.8, 10);

      // Seed-independent defaults untouched.
      expect(controller.fieldParams.moistureFreq).toBe(DEFAULT_FIELD_PARAMS.moistureFreq);
      expect(controller.fieldParams.falloffStrength).toBe(DEFAULT_FIELD_PARAMS.falloffStrength);
    });
  });

  describe('3. elevation commit: immediate 512² recompute', () => {
    it('clears the pending debounce, recomputes at 512, renders final, emits fields(final)', async () => {
      const { controller, worker, renderer, events } = makeController();
      // Seed the 512² cache so the commit can take the recompute path.
      controller.regenerate(1);
      worker.generateCalls[0].deferred.resolve(filledFields(512, 0.11, 0.22));
      await flush();
      const seedFields = controller.currentFields;
      expect(seedFields).not.toBeNull();
      worker.clear();
      renderer.clear();
      events.length = 0;

      controller.setElevation(0.7); // schedules the drag debounce…
      controller.commitElevation(); // …which is cancelled in favor of 512² now.
      vi.advanceTimersByTime(1000); // the cancelled debounce must never fire

      expect(worker.calls).toHaveLength(1);
      const call = worker.recomputeCalls[0];
      expect(call.method).toBe('recomputeElevation');
      expect(call.resolution).toBe(512);
      expect(call.params.elevationFreq).toBeCloseTo(2.5 + 2 * 0.7, 10);

      call.deferred.resolve(filledElevation(512, 0.77));
      await flush();

      // Final frame: setFields → rebuildBiomes → draw('biomes'), cached as
      // currentFields, reusing the cached 512² moisture half by reference.
      expect(renderer.log.map((c) => c.op)).toEqual(['setFields', 'rebuildBiomes', 'draw']);
      const drawCall = renderer.log[2];
      expect(drawCall.op === 'draw' && drawCall.mode).toBe('biomes');
      const finalFields = renderer.setFieldsCalls[0].fields;
      expect(finalFields.resolution).toBe(512);
      expect(finalFields.moisture).toBe(seedFields?.moisture);
      expect(finalFields.elevation[0]).toBeCloseTo(0.77, 5); // Float32 marker
      expect(controller.currentFields).toBe(finalFields);

      const fieldsEvents = events.filter(
        (e): e is Extract<ControllerEvent, { type: 'fields' }> => e.type === 'fields',
      );
      expect(fieldsEvents).toHaveLength(1);
      expect(fieldsEvents[0].final).toBe(true);
      expect(fieldsEvents[0].fields).toBe(finalFields);
    });
  });

  describe('4. preview moisture cache (per seed)', () => {
    it('first drag generates once at 256; later drags recompute elevation only and reuse the cached moisture', async () => {
      const { controller, worker, events } = makeController();
      controller.setSeed(7); // Generate-class alias; its 512² generate stays pending
      worker.clear(); // the preview cache is keyed by seed, not by the 512² cache

      // First drag on seed 7: cache miss → exactly one generate@256, whose
      // elevation serves that preview directly (no extra recompute).
      const served = await warmPreviewCache(controller, worker, 0.3);
      expect(worker.calls).toHaveLength(1);
      expect(worker.generateCalls[0].resolution).toBe(256);
      expect(worker.generateCalls[0].seed).toBe(7);
      worker.clear();

      // Second drag on the same seed: cache hit → elevation-only recompute,
      // no second generate; the preview reuses the cached moisture array.
      controller.setElevation(0.45);
      vi.advanceTimersByTime(40);

      expect(worker.generateCalls).toHaveLength(0);
      expect(worker.recomputeCalls).toHaveLength(1);
      const call = worker.recomputeCalls[0];
      expect(call.resolution).toBe(256);
      expect(call.seed).toBe(7);

      const freshElevation = filledElevation(256, 0.66);
      call.deferred.resolve(freshElevation);
      await flush();

      const previews = events.filter(
        (e): e is Extract<ControllerEvent, { type: 'preview' }> => e.type === 'preview',
      );
      const last = previews.at(-1);
      expect(last?.fields.resolution).toBe(256);
      expect(last?.fields.moisture).toBe(served.moisture); // same reference: cache hit
      expect(last?.fields.elevation).toBe(freshElevation);
    });
  });

  describe('5. stale responses are ignored', () => {
    it('a 512² elevation answer arriving after a newer regenerate never renders', async () => {
      const { controller, worker, renderer } = makeController();
      controller.regenerate(1);
      worker.generateCalls[0].deferred.resolve(filledFields(512, 0.11, 0.22));
      await flush();

      // Commit an elevation change but leave its 512² recompute pending.
      controller.setElevation(0.8, { commit: true });
      const stale = worker.recomputeCalls[0];
      expect(stale.resolution).toBe(512);

      // A new Generate-class request supersedes it and resolves first.
      controller.regenerate(2);
      worker.generateCalls.at(-1)!.deferred.resolve(filledFields(512, 0.99, 0.88));
      await flush();

      const setFieldsCount = renderer.setFieldsCalls.length;
      const lastBefore = renderer.setFieldsCalls.at(-1)?.fields;
      expect(lastBefore?.elevation[0]).toBeCloseTo(0.99, 5); // Float32 marker

      // The stale elevation response arrives LAST → dropped silently.
      stale.deferred.resolve(filledElevation(512, 0.5));
      await flush();

      expect(renderer.setFieldsCalls.length).toBe(setFieldsCount);
      expect(renderer.setFieldsCalls.at(-1)?.fields.elevation[0]).toBeCloseTo(0.99, 5);
    });
  });

  describe('6. animation cancel hook (Generate-class)', () => {
    it('fires the hook before the worker request is issued, on every regenerate', () => {
      const order: string[] = [];
      const { controller } = makeController(() => order.push('request'));
      const hookCalls: boolean[] = [];
      controller.setAnimationCancel(() => {
        hookCalls.push(true);
        order.push('cancel');
        return true; // "an animation was active"
      });

      controller.regenerate();
      controller.regenerate(5);

      expect(hookCalls.length).toBeGreaterThanOrEqual(1);
      // Each cancel precedes its worker request — cancel is fired FIRST.
      expect(order).toEqual(['cancel', 'request', 'cancel', 'request']);
    });
  });

  describe('7. worker failures', () => {
    it('swallows SupersededError; surfaces everything else as an error event', async () => {
      const { controller, worker, events } = makeController();

      controller.regenerate(1);
      worker.generateCalls[0].deferred.reject(new SupersededError());
      await flush();
      expect(events.some((e) => e.type === 'error')).toBe(false);

      controller.regenerate(2);
      const boom = new Error('boom');
      worker.generateCalls.at(-1)!.deferred.reject(boom);
      await flush();

      const errors = events.filter(
        (e): e is Extract<ControllerEvent, { type: 'error' }> => e.type === 'error',
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].error).toBe(boom);
    });
  });

  describe('8. input clamping', () => {
    it('clamps elevation and moisture to [0,1]', () => {
      const { controller } = makeController();
      controller.setElevation(5);
      expect(controller.state.elevation).toBe(1);
      controller.setMoisture(-1);
      expect(controller.state.moisture).toBe(0);
    });
  });

  describe('9. presets (T12)', () => {
    it('applyPreset issues exactly ONE generate@512 and ZERO recomputes; overrides ride along; cancel hook fires first; state updated', () => {
      const order: string[] = [];
      const { controller, worker, events } = makeController(() => order.push('request'));
      controller.setAnimationCancel(() => {
        order.push('cancel');
        return true;
      });

      controller.applyPreset({
        elevation: 0.85,
        moisture: 0.55,
        overrides: { falloffStrength: 0.35, elevationOctaves: 6 },
      });

      // One Generate-class request at 512²; no preview/commit recompute.
      expect(worker.calls).toHaveLength(1);
      expect(worker.generateCalls).toHaveLength(1);
      expect(worker.recomputeCalls).toHaveLength(0);
      const call = worker.generateCalls[0];
      expect(call.resolution).toBe(512);
      expect(call.seed).toBe(0);
      // Overrides carried; slider-derived keys still derived (0.85 → 4.2/1.71).
      expect(call.params.falloffStrength).toBeCloseTo(0.35, 10);
      expect(call.params.elevationOctaves).toBe(6);
      expect(call.params.elevationFreq).toBeCloseTo(2.5 + 2 * 0.85, 10);
      expect(call.params.redistribution).toBeCloseTo(1.2 + 0.6 * 0.85, 10);

      // Generate-class ordering: the cancel hook fires BEFORE the request.
      expect(order).toEqual(['cancel', 'request']);

      // One batch state event with both slider positions; state updated.
      const states = events.filter(
        (e): e is Extract<ControllerEvent, { type: 'state' }> => e.type === 'state',
      );
      expect(states).toHaveLength(1);
      expect(states[0].state).toEqual({ seed: 0, elevation: 0.85, moisture: 0.55 });
      expect(controller.state).toEqual({ seed: 0, elevation: 0.85, moisture: 0.55 });
    });

    it('applyPreset cancels a pending elevation-drag debounce (no stray preview)', () => {
      const { controller, worker } = makeController();
      controller.setElevation(0.3); // schedules the 30ms preview debounce
      worker.clear();

      controller.applyPreset({ elevation: 0.4, moisture: 0.5, overrides: { falloffStrength: 0.08 } });
      vi.advanceTimersByTime(1000); // the cancelled debounce must never fire

      expect(worker.calls).toHaveLength(1); // only the preset's generate@512
      expect(worker.generateCalls[0].resolution).toBe(512);
      expect(worker.recomputeCalls).toHaveLength(0);
    });

    it('fieldParams layers overrides over defaults; slider-derived keys stay derived', () => {
      const { controller } = makeController();
      controller.applyPreset({
        elevation: 0.85,
        moisture: 0.55,
        overrides: { falloffStrength: 0.35, elevationOctaves: 6 },
      });
      expect(controller.fieldParams.falloffStrength).toBeCloseTo(0.35, 10); // wins over default 0.03
      expect(controller.fieldParams.elevationOctaves).toBe(6); // wins over default 5
      expect(controller.fieldParams.elevationFreq).toBeCloseTo(4.2, 10); // still slider-derived
      expect(controller.fieldParams.redistribution).toBeCloseTo(1.71, 10); // still slider-derived
      expect(controller.fieldParams.moistureFreq).toBe(DEFAULT_FIELD_PARAMS.moistureFreq); // untouched
    });

    it('manual elevation input clears the overrides (custom terrain); moisture input does not', () => {
      const { controller } = makeController();
      controller.applyPreset({ elevation: 0.85, moisture: 0.55, overrides: { falloffStrength: 0.35 } });
      expect(controller.fieldParams.falloffStrength).toBeCloseTo(0.35, 10);

      // Moisture stays classification-only: terrain character must not change.
      controller.setMoisture(0.9);
      expect(controller.fieldParams.falloffStrength).toBeCloseTo(0.35, 10);

      // Manual elevation move → fully slider-derived defaults again.
      controller.setElevation(0.5);
      expect(controller.fieldParams).toEqual(DEFAULT_FIELD_PARAMS);
    });

    it('applyPreset with overrides null clears previously installed overrides', () => {
      const { controller } = makeController();
      controller.applyPreset({
        elevation: 0.85,
        moisture: 0.55,
        overrides: { falloffStrength: 0.35, elevationOctaves: 6 },
      });
      controller.applyPreset({ elevation: 0.5, moisture: 0.5, overrides: null });
      expect(controller.fieldParams).toEqual(DEFAULT_FIELD_PARAMS);
      expect(controller.state).toEqual({ seed: 0, elevation: 0.5, moisture: 0.5 });
    });

    it('regenerate keeps the overrides (Generate re-runs the current params)', () => {
      const { controller, worker } = makeController();
      controller.applyPreset({ elevation: 0.85, moisture: 0.55, overrides: { falloffStrength: 0.35 } });
      controller.regenerate(42);
      expect(worker.generateCalls).toHaveLength(2);
      expect(worker.generateCalls[1].params.falloffStrength).toBeCloseTo(0.35, 10);
    });
  });

  describe('10. T11: fields cause + shared-state boot/restore', () => {
    it("final fields carry cause 'generate' on the regenerate path and 'elevation-commit' on the commit path", async () => {
      const { controller, worker, events } = makeController();

      controller.regenerate(1);
      worker.generateCalls[0].deferred.resolve(filledFields(512, 0.1, 0.2));
      await flush();

      controller.setElevation(0.7, { commit: true });
      worker.recomputeCalls[0].deferred.resolve(filledElevation(512, 0.7));
      await flush();

      const fieldsEvents = events.filter(
        (e): e is Extract<ControllerEvent, { type: 'fields' }> => e.type === 'fields',
      );
      expect(fieldsEvents).toHaveLength(2);
      expect(fieldsEvents[0].cause).toBe('generate');
      expect(fieldsEvents[1].cause).toBe('elevation-commit');
    });

    it("commit before any fields resolved (generate fallback) is still an 'elevation-commit' arrival", async () => {
      const { controller, worker, events } = makeController();
      controller.commitElevation();
      expect(worker.generateCalls).toHaveLength(1); // no cached 512² fields → generate fallback
      worker.generateCalls[0].deferred.resolve(filledFields(512, 0.3, 0.4));
      await flush();

      const fieldsEvents = events.filter(
        (e): e is Extract<ControllerEvent, { type: 'fields' }> => e.type === 'fields',
      );
      expect(fieldsEvents).toHaveLength(1);
      expect(fieldsEvents[0].cause).toBe('elevation-commit');
    });

    it('applySharedState: ONE generate@512, zero recomputes, ONE state event, state set, preset overrides installed', () => {
      const { controller, worker, events } = makeController();

      controller.applySharedState({ seed: 42, elevation: 0.8, moisture: 0.3, presetId: 'archipelago' });

      // Single-churn boot: one worker request total, generate channel, 512².
      expect(worker.calls).toHaveLength(1);
      expect(worker.generateCalls).toHaveLength(1);
      expect(worker.recomputeCalls).toHaveLength(0);
      const call = worker.generateCalls[0];
      expect(call.seed).toBe(42);
      expect(call.resolution).toBe(512);
      // Archipelago overrides ride along; slider-derived keys stay derived.
      // (falloff 0.7 = T3b recalibrated registry value; elevationNormHigh
      // 0.9998 = T3c recalibration — snow cap for scattered islets.)
      expect(call.params.falloffStrength).toBeCloseTo(0.7, 10);
      expect(call.params.elevationOctaves).toBe(6);
      expect(call.params.elevationNormHigh).toBeCloseTo(0.9998, 10);
      expect(call.params.elevationFreq).toBeCloseTo(2.5 + 2 * 0.8, 10);

      // State set in one step; exactly ONE state event (no storm).
      expect(controller.state).toEqual({ seed: 42, elevation: 0.8, moisture: 0.3 });
      expect(controller.hasOverrides).toBe(true);
      const states = events.filter(
        (e): e is Extract<ControllerEvent, { type: 'state' }> => e.type === 'state',
      );
      expect(states).toHaveLength(1);
      expect(states[0].state).toEqual({ seed: 42, elevation: 0.8, moisture: 0.3 });
    });

    it('applySharedState with presetId null or unknown installs no overrides (pure slider params)', () => {
      const { controller, worker } = makeController();
      controller.applySharedState({ seed: 7, elevation: 0.5, moisture: 0.5, presetId: null });
      expect(controller.hasOverrides).toBe(false);
      expect(worker.generateCalls[0].params).toEqual(DEFAULT_FIELD_PARAMS);

      controller.applySharedState({ seed: 7, elevation: 0.5, moisture: 0.5, presetId: 'not-a-preset' });
      expect(controller.hasOverrides).toBe(false);
      expect(worker.generateCalls[1].params).toEqual(DEFAULT_FIELD_PARAMS);
    });

    it('applySharedState clamps sliders and floors the seed into [0, SEED_MAX] (hardening)', () => {
      const { controller, worker } = makeController();
      controller.applySharedState({ seed: -3.7, elevation: 5, moisture: -1, presetId: null });
      expect(controller.state).toEqual({ seed: 0, elevation: 1, moisture: 0 });
      // A hand-edited hash can carry anything finite: past SEED_MAX it clamps
      // (and the write-back pins the clamped URL, so reload reproduces the
      // map); non-finite garbage settles on the default seed.
      controller.applySharedState({ seed: 1e30, elevation: 0.5, moisture: 0.5, presetId: null });
      expect(worker.generateCalls.at(-1)?.seed).toBe(999_999_999);
      controller.applySharedState({
        seed: Number.POSITIVE_INFINITY,
        elevation: 0.5,
        moisture: 0.5,
        presetId: null,
      });
      expect(worker.generateCalls.at(-1)?.seed).toBe(0);
    });

    it('hasOverrides transitions: applyPreset→true, setMoisture→stays true, setElevation→false', () => {
      const { controller } = makeController();
      expect(controller.hasOverrides).toBe(false);

      controller.applyPreset({ elevation: 0.4, moisture: 0.5, overrides: { falloffStrength: 0.08 } });
      expect(controller.hasOverrides).toBe(true);

      controller.setMoisture(0.9); // climate nudge: never clears terrain overrides
      expect(controller.hasOverrides).toBe(true);

      controller.setElevation(0.41); // manual terrain input → custom
      expect(controller.hasOverrides).toBe(false);

      controller.setMoisture(0.2);
      controller.setSeed(9);
      expect(controller.hasOverrides).toBe(false); // stays off
    });
  });

  describe('11. T16-fix F2: dispose releases resources via the onDispose hook', () => {
    it('dispose fires the hook exactly once (idempotent), never while live; safe without a hook', () => {
      // No hook wired: dispose stays safe (controller-only usage).
      expect(() =>
        new MapController({ worker: new FakeWorkerPort(), renderer: new FakeRendererPort() }).dispose(),
      ).not.toThrow();

      let hookCalls = 0;
      const controller = new MapController({
        worker: new FakeWorkerPort(),
        renderer: new FakeRendererPort(),
        onDispose: () => {
          hookCalls += 1;
        },
      });
      controller.regenerate(); // live controller: the hook must not fire early
      controller.setMoisture(0.6);
      expect(hookCalls).toBe(0);

      controller.dispose();
      controller.dispose(); // idempotent: first call wins
      expect(hookCalls).toBe(1);
    });

    it('dispose-during-pending-generate: the hook fires, no error event surfaces, nothing rethrows', async () => {
      const events: ControllerEvent[] = [];
      const seen: string[] = [];
      const worker = new FakeWorkerPort();
      const controller = new MapController({
        worker,
        renderer: new FakeRendererPort(),
        onDispose: () => seen.push('terminate'),
      });
      controller.subscribe((e) => events.push(e));

      controller.regenerate(7); // generate left pending (deferred never resolved)
      expect(worker.generateCalls).toHaveLength(1);

      controller.dispose();
      expect(seen).toEqual(['terminate']); // resources released synchronously

      // The pending request's eventual rejection path is disposed-guarded:
      // resolving OR rejecting the deferred after dispose must stay silent.
      worker.generateCalls[0].deferred.reject(new Error('map worker was terminated'));
      await flush();
      expect(events.filter((e) => e.type === 'error')).toEqual([]); // no error surface
      expect(worker.calls.length).toBe(1); // no further worker churn
    });
  });
});
