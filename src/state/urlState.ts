/**
 * URL-hash state (plan T13): serialize/deserialize the full control state
 * (seed + both sliders + active preset name) to/from the URL hash.
 *
 * Pure + port-injected by design — this module references NO DOM globals
 * (never `globalThis.location`): `LocationPort` is the narrow structural port
 * the real wiring satisfies (T11 reads on boot; T14's share button writes).
 * Hash writes go through `replaceState` semantics only — no history spam.
 *
 * Sanitization is total: `parseHashBody` NEVER throws. Anything malformed
 * (empty/whitespace, garbage, missing/wrong `v` version, unparseable numbers)
 * falls back to `DEFAULT_SHARED_STATE`; the `v` field exists so future format
 * changes can migrate old hashes instead of discarding them.
 */

/** Wire-format version. Bump + add a migration branch in `parseHashBody`. */
export const STATE_VERSION = 1 as const;

export interface SharedState {
  version: typeof STATE_VERSION;
  /** Integer ≥ 0. */
  seed: number;
  /** Elevation slider position, [0,1]. */
  elevation: number;
  /** Moisture slider position, [0,1]. */
  moisture: number;
  /**
   * Active preset id. T12 validates it against its registry; here it only has
   * to survive the wire (lowercase slug) — anything else parses to `null`.
   */
  preset: string | null;
}

export const DEFAULT_SHARED_STATE: SharedState = {
  version: STATE_VERSION,
  seed: 0,
  elevation: 0.5,
  moisture: 0.5,
  preset: null,
};

/** Preset ids on the wire: short lowercase slugs, nothing else. */
const PRESET_PATTERN = /^[a-z]{1,24}$/;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fresh copy per parse, so callers can mutate without aliasing the default. */
function freshDefault(): SharedState {
  return { ...DEFAULT_SHARED_STATE };
}

/** Slider → compact ≤2-decimal text ("0.5", "0.75", "1", "0"). */
function formatSlider(v: number): string {
  return String(Number(clamp01(v).toFixed(2)));
}

/**
 * Strict numeric parse for one wire field. NaN = unusable. The empty-string
 * guard is load-bearing: `Number('') === 0`, which would silently forge a 0.
 */
function parseFiniteNumber(raw: string): number {
  if (raw.trim() === '') return Number.NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Compact hash body (no leading '#'): `v=1&seed=123&el=0.5&mo=0.75&preset=continent`.
 * Sliders are rounded to 2 decimals with trailing zeros trimmed; the seed is
 * floored to a non-negative integer; `preset` is omitted when null (or when a
 * caller passes a value that could not have come from a valid hash anyway).
 */
export function serializeState(state: SharedState): string {
  const parts = [
    `v=${String(STATE_VERSION)}`,
    `seed=${String(Math.max(0, Math.floor(state.seed)))}`,
    `el=${formatSlider(state.elevation)}`,
    `mo=${formatSlider(state.moisture)}`,
  ];
  if (state.preset !== null && PRESET_PATTERN.test(state.preset)) {
    parts.push(`preset=${state.preset}`);
  }
  return parts.join('&');
}

/**
 * Parse + sanitize a hash body (the part after '#'). Field-level rules:
 * sliders clamp to [0,1]; seed floors to an integer ≥ 0 (negative → default
 * seed); preset must match the slug pattern (else null). Whole-body rules:
 * empty/whitespace, garbage, a missing/non-1 `v`, or an unparseable number
 * yield `DEFAULT_SHARED_STATE`. Never throws.
 */
export function parseHashBody(body: string): SharedState {
  try {
    const params = new URLSearchParams(body);

    // Version gate: unknown future formats are not ours to guess at.
    const versionRaw = params.get('v');
    if (versionRaw === null) return freshDefault();
    const version = parseFiniteNumber(versionRaw);
    if (Number.isNaN(version) || version !== STATE_VERSION) return freshDefault();

    const state = freshDefault();

    const seedRaw = params.get('seed');
    if (seedRaw !== null) {
      const seed = parseFiniteNumber(seedRaw);
      if (Number.isNaN(seed)) return freshDefault();
      state.seed = Math.max(0, Math.floor(seed));
    }

    const elevationRaw = params.get('el');
    if (elevationRaw !== null) {
      const elevation = parseFiniteNumber(elevationRaw);
      if (Number.isNaN(elevation)) return freshDefault();
      state.elevation = clamp01(elevation);
    }

    const moistureRaw = params.get('mo');
    if (moistureRaw !== null) {
      const moisture = parseFiniteNumber(moistureRaw);
      if (Number.isNaN(moisture)) return freshDefault();
      state.moisture = clamp01(moisture);
    }

    const presetRaw = params.get('preset');
    if (presetRaw !== null && PRESET_PATTERN.test(presetRaw)) {
      state.preset = presetRaw;
    }

    return state;
  } catch {
    // URLSearchParams does not throw on strings; this guards the impossible.
    return freshDefault();
  }
}

/** Location-like port for testability (the real `location`/`history` pair satisfies it). */
export interface LocationPort {
  hash: string;
  replaceState(url: string): void;
}

/**
 * Read state from a location's hash: `''` / `'#'` → null (no usable hash —
 * the caller applies defaults); `'#v=1&…'` → `parseHashBody` of the body.
 */
export function readStateFromLocation(loc: LocationPort): SharedState | null {
  const raw = loc.hash;
  if (raw.trim() === '') return null;
  const body = raw.startsWith('#') ? raw.slice(1) : raw;
  if (body.trim() === '') return null;
  return parseHashBody(body);
}

/** Immediate hash write via `replaceState` — no history entry is created. */
export function writeStateToLocation(loc: LocationPort, state: SharedState): void {
  loc.replaceState(`#${serializeState(state)}`);
}

/** Injected scheduler for `createUrlStateWriter` (defaults = real timers). */
export interface UrlStateWriterOptions {
  /** Coalescing window, default 200 ms. */
  delayMs?: number;
  /** Default `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** Default `clearTimeout`. */
  cancel?: (handle: unknown) => void;
}

export interface UrlStateWriter {
  push(state: SharedState): void;
  flush(): void;
}

/**
 * Coalescing hash writer (trailing edge): the first `push` in a batch arms one
 * timer for `delayMs`; pushes inside the window only replace the pending
 * state; the fire writes the LAST state once. `flush()` forces the pending
 * write synchronously and cancels the timer; with nothing pending it is a
 * no-op. All writes go through `writeStateToLocation` (replaceState only).
 */
export function createUrlStateWriter(loc: LocationPort, opts: UrlStateWriterOptions = {}): UrlStateWriter {
  const delayMs = opts.delayMs ?? 200;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let pending: SharedState | null = null;
  let handle: unknown = null;
  let armed = false;

  const fire = (): void => {
    armed = false;
    handle = null;
    if (pending === null) return;
    const state = pending;
    pending = null;
    writeStateToLocation(loc, state);
  };

  return {
    push(state: SharedState): void {
      pending = state;
      if (!armed) {
        armed = true;
        handle = schedule(fire, delayMs);
      }
    },
    flush(): void {
      if (pending === null) return; // nothing pending: no write, no cancel
      if (armed) {
        cancel(handle);
        armed = false;
        handle = null;
      }
      const state = pending;
      pending = null;
      writeStateToLocation(loc, state);
    },
  };
}
