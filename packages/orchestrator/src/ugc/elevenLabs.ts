import { getServerEnv } from "@pulse/shared";
import { VOICE_PRESET_V1, UGC_VOICE_SLOTS, formatVoScript, type UgcVoiceSlot } from "./presets/voicePresets.js";

function elevenKey(): string | undefined {
  return (
    process.env.ELEVENLABS_API_KEY ??
    (() => {
      try {
        return getServerEnv().ELEVENLABS_API_KEY;
      } catch {
        return undefined;
      }
    })()
  );
}

export function elevenLabsConfigured(): boolean {
  return Boolean(elevenKey());
}

export function resolveUgcVoiceId(slot: UgcVoiceSlot = "casual_f", override?: string | null): string {
  if (override && override.length > 5) return override;
  try {
    const envDefault = getServerEnv().ELEVENLABS_VOICE_ID;
    if (envDefault) return envDefault;
  } catch {
    /* ignore */
  }
  return UGC_VOICE_SLOTS[slot] ?? UGC_VOICE_SLOTS.casual_f;
}

export async function synthesizeUgcVoiceover(opts: {
  text: string;
  voiceId?: string;
  slot?: UgcVoiceSlot;
}): Promise<Buffer | null> {
  const key = elevenKey();
  if (!key) return null;

  const voiceId = resolveUgcVoiceId(opts.slot ?? "casual_f", opts.voiceId);
  const text = formatVoScript(opts.text);
  if (text.length < 4) return null;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: VOICE_PRESET_V1.modelId,
      voice_settings: {
        stability: VOICE_PRESET_V1.stability,
        similarity_boost: VOICE_PRESET_V1.similarityBoost,
        style: VOICE_PRESET_V1.style,
        use_speaker_boost: VOICE_PRESET_V1.speakerBoost,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`elevenlabs ${res.status}: ${err.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
