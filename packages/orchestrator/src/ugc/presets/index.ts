/** Locked v1 winners from fixture sniff-tests (agent tuning pass). */

export {
  UGC_PRESET_VERSION,
  SCRIPT_SYSTEM,
  SCRIPT_BANNED,
  pickAngle,
  UGC_ANGLES,
} from "./scriptPresets.js";
export type { UgcAngle } from "./scriptPresets.js";

export {
  STILL_NEGATIVE,
  productOnlyStillPrompt,
  productInHandStillPrompt,
  actorSelfiePrompt,
  V1_STILL_MODE,
} from "./stillPresets.js";

export {
  MOTION_STYLE_LOCK,
  MOTION_NEGATIVE,
  MOTION_SECONDS_PER_SCENE,
  motionPromptForScene,
} from "./motionPresets.js";

export { VOICE_PRESET_V1, UGC_VOICE_SLOTS, formatVoScript } from "./voicePresets.js";
export type { UgcVoiceSlot } from "./voicePresets.js";

export { ASSEMBLY_V1, CAPTION_STYLE } from "./assemblyPresets.js";

import { UGC_PRESET_VERSION } from "./scriptPresets.js";
import { V1_STILL_MODE } from "./stillPresets.js";
import { MOTION_SECONDS_PER_SCENE } from "./motionPresets.js";
import { VOICE_PRESET_V1 } from "./voicePresets.js";
import { ASSEMBLY_V1 } from "./assemblyPresets.js";

/**
 * Promoted defaults after fixture tuning.
 * Changelog:
 * - v1: product-only stills; stability 0.42; 4s scenes; max 2 regens; subtle motion
 */
export const PRESETS_V1 = {
  version: UGC_PRESET_VERSION,
  stillMode: V1_STILL_MODE,
  motionSeconds: MOTION_SECONDS_PER_SCENE,
  motionIntensity: "subtle" as const,
  voice: { ...VOICE_PRESET_V1 },
  assembly: { ...ASSEMBLY_V1 },
  maxRegensPerScene: 2,
  requireProductRefs: true,
  talkingHeadEnabled: false,
} as const;

export type PresetsV1 = typeof PRESETS_V1;
