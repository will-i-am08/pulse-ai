/**
 * Unified CreativePlan — surface + quality + idea/carousel intent from owner text
 * or kickoff payload. Downstream imaging/formats keep their own generators; this is
 * the Creative Director stack's single planning shape.
 */

import type { Brand } from "@pulse/shared";
import { wantsResearchedIdeaSlides } from "./formats.js";
import { textWantsCarousel } from "./carouselIntent.js";
import {
  inferVisualModeFromText,
  resolveVisualMode,
  type VisualMode,
} from "./visualMode.js";

export type CreativeSurface =
  | "photo_carousel"
  | "designed_carousel"
  | "photo_feed"
  | "designed_feed";

export type CreativeQuality = "draft" | "standard" | "premium";

export type CreativePlan = {
  surface: CreativeSurface;
  ideaMode: boolean;
  topicHint: string | null;
  visuals: VisualMode;
  quality: CreativeQuality;
  preferCarousel: boolean;
};

const PREMIUM_QUALITY_RE =
  /\b(premium|best|high[- ]?end|cinematic|editorial|luxury)\b/i;

const DRAFT_QUALITY_RE = /\b(quick|rough|draft|cheap)\b/i;

function surfaceFor(preferCarousel: boolean, visuals: VisualMode): CreativeSurface {
  if (preferCarousel) {
    return visuals === "designed" ? "designed_carousel" : "photo_carousel";
  }
  return visuals === "designed" ? "designed_feed" : "photo_feed";
}

function inferQuality(text: string, ideaMode: boolean): CreativeQuality {
  if (ideaMode || PREMIUM_QUALITY_RE.test(text)) return "premium";
  if (DRAFT_QUALITY_RE.test(text)) return "draft";
  return "standard";
}

function topicFromText(text: string): string | null {
  const t = text.trim().slice(0, 400);
  return t || null;
}

function parseQuality(raw: unknown): CreativeQuality | null {
  const q = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (q === "draft" || q === "standard" || q === "premium") return q;
  return null;
}

/** Plan a creative from freeform owner SMS / brief text. */
export function planFromOwnerText(
  text: string,
  _brand?: Pick<Brand, "visual"> | null,
): CreativePlan {
  const raw = text ?? "";
  const topicHint = topicFromText(raw);
  const ideaMode = wantsResearchedIdeaSlides(raw);
  const visuals = inferVisualModeFromText(raw);
  // Prefer carousel when they asked for one (or researched idea slides).
  // "A post" alone does not forbid carousel — feed is just the default elsewhere.
  // "Not a carousel" / square graphic must stay feed (LAB-004).
  const preferCarousel = ideaMode || textWantsCarousel(raw);
  const quality = inferQuality(raw, ideaMode);

  return {
    surface: surfaceFor(preferCarousel, visuals),
    ideaMode,
    topicHint,
    visuals,
    quality,
    preferCarousel,
  };
}

/**
 * Plan from a kickoff queue payload. Honours explicit payload fields when set;
 * otherwise falls back to planFromOwnerText on topicHint/hint.
 */
export function planFromKickoffPayload(
  payload: Record<string, unknown>,
  brand: Pick<Brand, "visual">,
): CreativePlan {
  const text = String(payload.topicHint ?? payload.hint ?? "").trim();
  const base = planFromOwnerText(text, brand);

  const visuals =
    payload.visuals != null && String(payload.visuals).trim() !== ""
      ? resolveVisualMode(brand, payload)
      : base.visuals;

  let preferCarousel = base.preferCarousel;
  if (typeof payload.preferCarousel === "boolean") {
    preferCarousel = payload.preferCarousel;
  } else if (payload.format === "carousel") {
    preferCarousel = true;
  }

  const quality = parseQuality(payload.quality) ?? base.quality;

  let topicHint = base.topicHint;
  if (payload.topicHint != null) {
    topicHint = topicFromText(String(payload.topicHint));
  }

  const ideaMode = wantsResearchedIdeaSlides(topicHint ?? text);

  return {
    surface: surfaceFor(preferCarousel, visuals),
    ideaMode,
    topicHint,
    visuals,
    quality,
    preferCarousel,
  };
}
