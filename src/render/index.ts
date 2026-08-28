/** Public API of the render layer: pure composition (node-testable), the thin DOM renderer, and the staged reveal animation. */
export {
  buildBiomeLut,
  buildMoistureRamp,
  composeChunk,
  LUT_STEPS,
  MOISTURE_RAMP_FROM,
  MOISTURE_RAMP_STEPS,
  MOISTURE_RAMP_TO,
  packRGBA,
  quantizeToStep,
  RENDER_MODES,
  stepCenter,
} from './compose.ts';
export type { RenderMode } from './compose.ts';
export { MapRenderer } from './renderer.ts';
export { DEFAULT_ANIMATION_CONFIG, easeInOutQuad, StagedAnimation } from './animation.ts';
export type {
  AnimationConfig,
  AnimationEnv,
  AnimationRendererPort,
  AnimationStage,
} from './animation.ts';
