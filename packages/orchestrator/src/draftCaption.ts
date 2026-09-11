import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { query, queryOne, brandVoiceProfileSchema, getMedia, sanitizeChatText } from "@pulse/shared";
import type { Brand, MediaAsset, StrategyNote } from "@pulse/shared";
import { callLLM } from "./llm.js";
import { brandContextForPrompt } from "./brandContext.js";
import { factsForPrompt } from "./businessProfile.js";

// Anthropic vision accepts these image types; anything else we skip as an image.
const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGES = 4;
// Stay well under Anthropic's per-image cap after downscaling.
const MAX_IMAGE_BYTES = 4_500_000;

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

  // Micro-tells learned from real post history — the difference between
  // "sounds like AI" and "sounds like them". Only emit what's actually set.
  const m = profile.writing_mechanics;
  const mech: string[] = [];
  if (m.emoji_frequency) mech.push(`emoji: ${m.emoji_frequency}`);
  if (m.favourite_emojis.length) mech.push(`emojis they reach for: ${m.favourite_emojis.join(" ")}`);
  if (m.exclamation_usage) mech.push(`exclamation marks: ${m.exclamation_usage}`);
  if (m.ellipsis_usage) mech.push(`ellipses: ${m.ellipsis_usage}`);
  if (m.capitalisation) mech.push(`capitalisation: ${m.capitalisation}`);
  if (m.sentence_length) mech.push(`sentence length: ${m.sentence_length}`);
  if (m.punctuation_quirks.length) mech.push(`punctuation quirks: ${m.punctuation_quirks.join("; ")}`);
  if (m.openers.length) mech.push(`typical openers: ${m.openers.join(" / ")}`);
  if (m.sign_offs.length) mech.push(`typical sign-offs: ${m.sign_offs.join(" / ")}`);
  if (m.hashtag_style) mech.push(`hashtags: ${m.hashtag_style}`);
  if (m.cta_style) mech.push(`calls to action: ${m.cta_style}`);
  if (m.favourite_phrases.length) mech.push(`phrases they use: ${m.favourite_phrases.join("; ")}`);
  if (mech.length) {
    lines.push("Match these writing habits exactly (learned from their real posts):");
    for (const line of mech) lines.push(`- ${line}`);
  }

  const ps = profile.photo_style;
  const photo: string[] = [];
  if (ps.overall_aesthetic) photo.push(`aesthetic: ${ps.overall_aesthetic}`);
  if (ps.editing) photo.push(`editing: ${ps.editing}`);
  if (ps.colour_palette.length) photo.push(`colours: ${ps.colour_palette.join(", ")}`);
  if (photo.length) {
    lines.push("Their visual style (reference when the caption should match the look):");
    for (const line of photo) lines.push(`- ${line}`);
  }

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

  const facts = factsForPrompt(brand.facts);
  if (facts && !facts.startsWith("(no business")) {
    lines.push("Business facts (do not invent beyond these):");
    lines.push(facts);
  }

  const ctx = brandContextForPrompt(brand);
  if (ctx) {
    lines.push(ctx);
  } else if (!brand.icp?.segments?.length) {
    lines.push(
      "No ICP on file — do not invent a fake customer. Write generally; Kip can offer to research ICP later.",
    );
  }
  lines.push(
    "Never invent discounts, awards, testimonials, or proof points that are not in offers or business facts.",
  );

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

    // Downscale for the vision API: Anthropic caps image size and prefers the
    // long edge <= 1568px. Phone photos are often 10MB+, which 400s the call.
    let data: Uint8Array = blob.bytes;
    let mediaType: ImageMediaType = VISION_TYPES.has(m.content_type ?? "")
      ? (m.content_type as ImageMediaType)
      : "image/jpeg";
    try {
      const out = await sharp(Buffer.from(blob.bytes))
        .rotate() // respect EXIF orientation
        .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      data = new Uint8Array(out);
      mediaType = "image/jpeg";
    } catch {
      // sharp couldn't decode (unusual format) — fall back to the original bytes.
    }
    if (data.byteLength > MAX_IMAGE_BYTES) {
      // Still too large to send safely — skip this image rather than crash the draft.
      continue;
    }
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: Buffer.from(data).toString("base64") },
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

  return { caption: sanitizeChatText(caption), proposedTime: heuristicProposedTime(notes) };
}
