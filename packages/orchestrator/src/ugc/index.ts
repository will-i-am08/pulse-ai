/** UGC Reel/ad pipeline — multi-model (Nano Banana/Flux/Seedream + Kling/Seedance/Wan). */
export {
  looksLikeUgcRequest,
  ugcDestinationFromBody,
  ugcConfigured,
  queueUgcJob,
  processUgcJob,
  queueUgcRetune,
  looksLikeUgcRetune,
  parseUgcRetune,
} from "./pipeline.js";
export type { UgcDestination, UgcRetuneHint, QueueUgcResult } from "./pipeline.js";
export { describeUgcModelChains, falConfigured } from "./falClient.js";
export {
  STILL_MODELS,
  MOTION_MODELS,
  resolveStillChain,
  resolveMotionChain,
} from "./modelRouter.js";
export { PRESETS_V1 } from "./presets/index.js";
