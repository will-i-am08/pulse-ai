import { serviceClient, brandVoiceProfileSchema } from "@pulse/shared";
import type { BrandVoiceProfile } from "@pulse/shared";

// Onboarding answers arrive as a loose bag of operator input (a form, a
// questionnaire, whatever the dashboard collects) — accept both snake_case
// and camelCase keys and coerce leniently rather than requiring an exact shape.

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  }
  if (typeof v === "string" && v.trim().length > 0) {
    return v
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asEmojiPolicy(v: unknown): BrandVoiceProfile["emoji_policy"] {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  if (s.includes("none") || s.includes("no emoji")) return "none";
  if (s.includes("liberal") || s.includes("lots") || s.includes("heavy")) return "liberal";
  return "sparing";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function seedBrandVoice(
  brandId: string,
  answers: Record<string, unknown>,
): Promise<void> {
  const profile = brandVoiceProfileSchema.parse({
    tone: asStringArray(answers.tone ?? answers.tones),
    dos: asStringArray(answers.dos ?? answers.do),
    donts: asStringArray(answers.donts ?? answers.dont),
    example_captions: asStringArray(answers.example_captions ?? answers.examples),
    banned_words: asStringArray(answers.banned_words ?? answers.bannedWords),
    emoji_policy: asEmojiPolicy(answers.emoji_policy ?? answers.emojiPolicy),
    hashtag_policy: asString(answers.hashtag_policy ?? answers.hashtagPolicy),
    notes: asStringArray(answers.notes),
  });

  const db = serviceClient();

  const { error: brandErr } = await db
    .from("brands")
    .update({ brand_voice_profile: profile })
    .eq("id", brandId);
  if (brandErr) throw brandErr;

  const strategyRow = {
    brand_id: brandId,
    voice_notes: asString(answers.voice_notes ?? answers.voiceNotes) || null,
    posting_cadence: asString(answers.posting_cadence ?? answers.postingCadence) || null,
    best_times: asRecord(answers.best_times ?? answers.bestTimes),
    content_mix: asRecord(answers.content_mix ?? answers.contentMix),
    last_updated: new Date().toISOString(),
  };

  const { error: notesErr } = await db
    .from("strategy_notes")
    .upsert(strategyRow, { onConflict: "brand_id" });
  if (notesErr) throw notesErr;
}
