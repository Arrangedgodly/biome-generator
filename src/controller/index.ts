/** Public API of the update controller layer (T6): the controller + production wiring. */
export { MapController } from './map-controller.ts';
export { createMapController } from './create.ts';
export type { MapControllerBundle } from './create.ts';
export type {
  AnimationCancelHook,
  ControllerEvent,
  ControllerEvents,
  ControlState,
  FieldsCause,
  RendererPort,
  WorkerPort,
} from './map-controller.ts';
