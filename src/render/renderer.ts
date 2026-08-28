/**
 * Thin DOM blitting layer over the pure composition module (plan T7, D2).
 *
 * One fixed square canvas element (D2 commits 512², CSS-scaled with
 * `image-rendering: pixelated` — already on `#map-canvas` since T1). Each
 * render mode composes once into its own OFFSCREEN canvas via putImageData;
 * the visible canvas only ever receives drawImage blits (GPU-composited
 * crossfades via globalAlpha). getImageData is never called anywhere — D2's
 * no-readback rule (software-rendering demotion risk).
 */

import { buildBiomeLut, composeChunk, RENDER_MODES } from './compose.ts';
import type { RenderMode } from './compose.ts';
import type { ClassifyBiases, Fields } from '../generation/index.ts';

/** Chunk height for composition loops: 512² = 8 chunks of 64 rows (D2 <8ms/task budget). */
const CHUNK_ROWS = 64;

interface ModeSurface {
  /** Packed pixel buffer, one pixel per element (platform byte order, alpha 255). */
  readonly pixels: Uint32Array;
  /** Byte view over `pixels.buffer`, for the bulk copy into ImageData.data. */
  readonly bytes: Uint8ClampedArray;
  readonly image: ImageData;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  composed: boolean;
}

export class MapRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Visible canvas edge length in device pixels (D2: 512). */
  private readonly size: number;
  private fields: Fields | undefined;
  private biomeLut: Uint32Array;
  private surfaces: Partial<Record<RenderMode, ModeSurface>> = {};

  constructor(canvas: HTMLCanvasElement) {
    if (canvas.width <= 0 || canvas.width !== canvas.height) {
      throw new Error(
        `MapRenderer expects a square canvas (D2: 512×512), got ${canvas.width}×${canvas.height}`,
      );
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('MapRenderer: 2D context unavailable');
    // Preview fields (D2: 256² while dragging) blit-upscale to the fixed
    // canvas; nearest-neighbor keeps the chunky pixel style consistent with
    // the CSS-pixelated final frame.
    ctx.imageSmoothingEnabled = false;
    this.ctx = ctx;
    this.size = canvas.width;
    this.biomeLut = buildBiomeLut();
  }

  /** Internal resolution of the visible canvas (= field resolution at 1:1). */
  get resolution(): number {
    return this.size;
  }

  /**
   * Resolution of the currently cached fields (0 before any `setFields`) —
   * 512² on final frames, 256² during elevation-drag previews. The surveyor's
   * probe maps its coordinates through this, so its readings always describe
   * exactly what is on screen.
   */
  get fieldResolution(): number {
    return this.fields?.resolution ?? 0;
  }

  /**
   * Field-space sample for the surveyor's probe (delight pass): reads the
   * cached elevation/moisture arrays at integer pixel coordinates, clamped
   * into bounds. Pure array reads — `getImageData` is still never called
   * (D2's no-readback rule), and undefined before the first `setFields`.
   */
  sample(fx: number, fy: number): { elevation: number; moisture: number } | undefined {
    if (this.fields === undefined) return undefined;
    const r = this.fields.resolution;
    const x = Math.min(Math.max(Math.floor(fx), 0), r - 1);
    const y = Math.min(Math.max(Math.floor(fy), 0), r - 1);
    const i = y * r + x;
    return { elevation: this.fields.elevation[i], moisture: this.fields.moisture[i] };
  }

  /**
   * Caches new fields and (re)allocates every mode's pixel buffer, ImageData,
   * and offscreen canvas at the fields' resolution. All composed flags reset —
   * modes recompose lazily on next draw/crossfade, or eagerly via
   * `rebuildBiomes`.
   */
  setFields(fields: Fields): void {
    this.fields = fields;
    this.surfaces = {};
    const n = fields.resolution * fields.resolution;
    for (const mode of RENDER_MODES) {
      const canvas = document.createElement('canvas');
      canvas.width = fields.resolution;
      canvas.height = fields.resolution;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error(`MapRenderer: 2D context unavailable for '${mode}' offscreen canvas`);
      const pixels = new Uint32Array(n);
      this.surfaces[mode] = {
        pixels,
        bytes: new Uint8ClampedArray(pixels.buffer),
        image: ctx.createImageData(fields.resolution, fields.resolution),
        canvas,
        ctx,
        composed: false,
      };
    }
  }

  /**
   * Instant reclassification path for the moisture slider: bake new biases
   * into the biome LUT and recompose ONLY the biome mode — pure pixel work,
   * no noise, no worker (D2's palette-LUT decision exists for exactly this).
   * Skipped when the biome surface holds no composed content to refresh
   * (nothing is displaying it; the next draw composes with the new LUT).
   */
  rebuildBiomes(biases: ClassifyBiases): void {
    this.biomeLut = buildBiomeLut(biases);
    if (this.fields !== undefined && this.surfaces.biomes?.composed) {
      this.composeMode('biomes');
    }
  }

  /** Blits a mode's offscreen canvas onto the visible canvas, opaque. */
  draw(mode: RenderMode): void {
    const surface = this.requireSurface(mode);
    if (!surface.composed) this.composeMode(mode);
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(surface.canvas, 0, 0, this.size, this.size);
  }

  /**
   * GPU-composited crossfade between two pre-composed modes (D2's animation
   * primitive): `from` at alpha (1 − t), then `to` at alpha t, t clamped to
   * [0, 1]. Both endpoints are opaque, so any t yields a fully covered frame.
   */
  crossfade(from: RenderMode, to: RenderMode, t: number): void {
    const fromSurface = this.requireSurface(from);
    const toSurface = this.requireSurface(to);
    if (!fromSurface.composed) this.composeMode(from);
    if (!toSurface.composed) this.composeMode(to);
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    this.ctx.globalAlpha = 1 - clamped;
    this.ctx.drawImage(fromSurface.canvas, 0, 0, this.size, this.size);
    this.ctx.globalAlpha = clamped;
    this.ctx.drawImage(toSurface.canvas, 0, 0, this.size, this.size);
    this.ctx.globalAlpha = 1;
  }

  /** Composes a full mode frame in CHUNK_ROWS slices, then puts it offscreen. */
  private composeMode(mode: RenderMode): void {
    const fields = this.requireFields();
    const surface = this.requireSurface(mode);
    const rows = fields.resolution;
    for (let from = 0; from < rows; from += CHUNK_ROWS) {
      const to = Math.min(from + CHUNK_ROWS, rows);
      composeChunk(mode, fields, surface.pixels, from, to, this.biomeLut);
    }
    surface.image.data.set(surface.bytes);
    surface.ctx.putImageData(surface.image, 0, 0);
    surface.composed = true;
  }

  private requireFields(): Fields {
    if (this.fields === undefined) throw new Error('MapRenderer: no fields cached — call setFields() first');
    return this.fields;
  }

  private requireSurface(mode: RenderMode): ModeSurface {
    const surface = this.surfaces[mode];
    if (surface === undefined) {
      throw new Error(`MapRenderer: no '${mode}' surface — call setFields() first`);
    }
    return surface;
  }
}
