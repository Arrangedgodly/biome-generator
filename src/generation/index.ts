/** Public API of the field generation pipeline (pure, worker-ready). */
export { DEFAULT_FIELD_PARAMS, generateElevation, generateFields } from './fields.ts';
export type { FieldParams, Fields } from './fields.ts';
export {
  BIOME_IDS,
  BIOMES,
  ELEVATION_BANDS,
  MOISTURE_BANDS,
  MOUNTAIN_MOISTURE_SPLIT,
  NO_BIASES,
  classify,
} from './biomes.ts';
export type { BiomeId, BiomeInfo, ClassifyBiases } from './biomes.ts';
