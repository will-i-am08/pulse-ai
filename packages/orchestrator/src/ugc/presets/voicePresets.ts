/** ElevenLabs VO presets — conversational UGC, not announcer. */

export const VOICE_PRESET_V1 = {
  modelId: "eleven_multilingual_v2",
  stability: 0.42,
  similarityBoost: 0.75,
  style: 0.15,
  speakerBoost: true,
  speed: 0.97,
  targetLufs: -14,
  bedMusicDb: -20,
} as const;

export const UGC_VOICE_SLOTS = {
  casual_f: process.env.UGC_VOICE_CASUAL_F ?? "EXAVITQu4vr4xnSDxMaL",
  casual_m: process.env.UGC_VOICE_CASUAL_M ?? "VR6AewLTigWG4xSOukaG",
  calm: process.env.UGC_VOICE_CALM ?? "pNInz6obpgDQGcFmaJgB",
} as const;

export type UgcVoiceSlot = keyof typeof UGC_VOICE_SLOTS;

export function formatVoScript(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\.\s+/g, "... ")
    .replace(/,\s+/g, " — ")
    .trim()
    .slice(0, 1200);
}
