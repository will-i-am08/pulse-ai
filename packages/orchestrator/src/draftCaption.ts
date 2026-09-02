import Anthropic from "@anthropic-ai/sdk";
import { query, queryOne, brandVoiceProfileSchema, getMedia } from "@pulse/shared";
import type { Brand, MediaAsset, StrategyNote } from "@pulse/shared";
import { callLLM } from "./llm.js";

// Anthropic vision accepts these image types; anything else we skip as an image.
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGES = 4;

// Derive the content-block param type from the SDK's MessageParam so we don't
// depend on an exported name that varies across @anthropic-ai/sdk versions.
type ContentPart = Exclude<Anthropic.MessageParam["content"], string>[number];
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface DraftCaptionResult {
  caption: string;
  proposedTime: string | null;
}

async function loadBrand(brandId: string): Promise<Brand> {
  const brand = await queryOne<Brand>(`select * from brands where id = $1`, [brandId]);
  if (!brand) {
    throw new Error(`draftCaption: brand not found (${brandId}): no row`);
  }
  return brand;
}

async function loadStrategyNotes(brandId: string): Promise<StrategyNote | null> {
  return queryOne<StrategyNote>(`select * from strategy_notes where brand_id = $1`, [brandId]);
}

async function loadMedia(brandId: string, mediaIds: string[]): Promise<MediaAsset[]> {
  if (mediaIds.length === 0) return [];
  return query<MediaAsset>(
    `select * from media_assets where brand_id = $1 and id = any($2::uuid[])`,
    [brandId, mediaIds],
  );
}

function buildSystemPrompt(brand: Brand, notes: StrategyNote | null): string {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const lines: string[] = [];

  lines.push(`You are drafting a social media caption for "${brand.name}".`);
  lines.push(
    "When photos are attached, look at what is actually in them and write a caption about that. " +
      "Never say you cannot see the image.",
  );
  lines.push("Output ONLY the caption text — no preamble, no surrounding quotes, no markdown.");

  if (profile.tone.length) lines.push(`Tone: ${profile.tone.join(", ")}.`);
  if (profile.dos.length) lines.push(`Do: ${profile.dos.join("; ")}.`);
  if (profile.donts.length) lines.push(`Don't: ${profile.donts.join("; ")}.`);
  if (profile.banned_words.length) lines.push(`Never use these words: ${profile.banned_words.join(", ")}.`);
  lines.push(`Emoji policy: ${profile.emoji_policy}.`);
  if (profile.hashtag_policy) lines.push(`Hashtag policy: ${profile.hashtag_policy}.`);

  if (profile.example_captions.length) {
    lines.push("Examples of this brand's voice (match the style, don't copy):");
    for (const ex of profile.example_captions.slice(0, 5)) lines.push(`- "${ex}"`);
  }

  if (profile.notes.length) {
    lines.push("Learned rules from past client corrections — follow these closely:");
    for (const n of profile.notes.slice(-10)) lines.push(`- ${n}`);
  }

  if (notes?.voice_notes) lines.push(`Additional voice notes: ${notes.voice_notes}`);
  if (notes?.content_mix && Object.keys(notes.content_mix).length) {
    lines.push(`Content mix guidance: ${JSON.stringify(notes.content_mix)}`);
  }

  return lines.join("\n");
}

/**
 * Simple heuristic: scan strategy_notes.best_times (free-form jsonb) for any
 * "HH:MM"-looking strings and propose the next upcoming one. Returns null
 * when nothing usable is configured — the dashboard/worker can still
 * schedule manually.
 */
function heuristicProposedTime(notes: StrategyNote | null): string | null {
  const bestTimes = notes?.best_times;
  if (!bestTimes || typeof bestTimes !== "object") return null;

  const times = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string" && /^\d{1,2}:\d{2}$/.test(v)) {
      times.add(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(bestTimes);
  if (times.size === 0) return null;

  const sorted = [...times].sort();
  const now = new Date();

  for (const t of sorted) {
    const [h, m] = t.split(":").map(Number);
    if (h === undefined || m === undefined) continue;
    const candidate = new Date(now);
    candidate.setHours(h, m, 0, 0);
    // Give a 15-minute buffer so we don't propose a time that's basically now.
    if (candidate.getTime() > now.getTime() + 15 * 60 * 1000) {
      return candidate.toISOString();
    }
  }

  // Every configured time today has passed — use the earliest one tomorrow.
  const first = sorted[0];
  if (!first) return null;
  const [h, m] = first.split(":").map(Number);
  if (h === undefined || m === undefined) return null;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(h, m, 0, 0);
  return tomorrow.toISOString();
}

export async function draftCaption(brandId: string, mediaIds: string[]): Promise<DraftCaptionResult> {
  const [brand, notes, media] = await Promise.all([
    loadBrand(brandId),
    loadStrategyNotes(brandId),
    loadMedia(brandId, mediaIds),
  ]);

  // Attach the actual photos (base64) so the model captions what's really shown.
  const content: ContentPart[] = [];
  let attached = 0;
  for (const m of media.filter((x) => x.kind === "photo").slice(0, MAX_IMAGES)) {
    const blob = await getMedia(m.id);
    if (!blob) continue;
    const mediaType = (VISION_TYPES.has(m.content_type ?? "") ? m.content_type! : "image/jpeg") as ImageMediaType;
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: Buffer.from(blob.bytes).toString("base64") },
    });
    attached++;
  }
  const hasVideo = media.some((m) => m.kind === "video");

  const instruction =
    attached > 0
      ? `Write an on-brand caption for the attached photo${attached > 1 ? "s" : ""}.${hasVideo ? " (There is also a video in this batch.)" : ""}`
      : hasVideo
        ? "The client sent a video (which you can't view). Draft an on-brand caption suitable for a short video clip — keep it flexible."
        : "Draft a generic on-brand caption.";
  content.push({ type: "text", text: instruction });

  const caption = await callLLM({
    system: buildSystemPrompt(brand, notes),
    messages: [{ role: "user", content }],
    maxTokens: 400,
  });

  return { caption: caption.trim(), proposedTime: heuristicProposedTime(notes) };
}
