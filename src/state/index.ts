/** Public API of the URL-hash state layer (T13). */
export {
  STATE_VERSION,
  DEFAULT_SHARED_STATE,
  serializeState,
  parseHashBody,
  readStateFromLocation,
  writeStateToLocation,
  createUrlStateWriter,
} from './urlState.ts';
export type { SharedState, LocationPort, UrlStateWriter, UrlStateWriterOptions } from './urlState.ts';
