/** Public API of the UI layer (T10): the DI-friendly control panel builder. */
export {
  buildControlPanel,
  defaultRandomSeed,
  WORKER_FAILED_MESSAGE,
  SHARE_FLASH_MS,
  SHARE_FLASH_TEXT,
} from './control-panel.ts';
export type {
  ControlPanelElements,
  ControlPanelHandle,
  ControlPanelPorts,
  PanelControllerEvent,
  PanelStage,
  PanelTimer,
} from './control-panel.ts';
