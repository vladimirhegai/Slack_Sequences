/** Typed host-contract island stripping and reinjection repairs. */
export {
  stripUnusedHostPlanIslands,
  stripAllHostPlanIslands,
  injectLayoutIntentHints,
  reconcileContractBindings,
  reconcileCameraWorldPlanes,
  injectWorldLayoutStyles,
  cameraWorldStyle,
  CAMERA_CELL_STRIDE_X,
  CAMERA_CELL_STRIDE_Y,
} from "./implementation.ts";
