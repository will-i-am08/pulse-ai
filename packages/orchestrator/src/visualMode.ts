import type { Brand, VisualProfile } from "@pulse/shared";

/**
 * How Kip should render draft creatives.
 * - photo: stock/AI photography (default — assume photos unless told otherwise)
 * - designed: typographic text cards / tip slides (when photos won't work or user asked)
 */
export type VisualMode = "photo" | "designed";

// Explicit text-card / graphic asks only — do NOT treat "I have no photos" as designed.
const DESIGNED_ONLY_RE =
  /\b(text[- ]?(cards?|only)|quote cards?|designed (slides?|cards?|graphics?)|plain[- ]?background|typography[- ]?only|graphics? only)\b/i;

const PHOTO_ASK_RE =
  /\b(stock|generated|ai[- ]?(generated|made|created)|synthetic|photos?|pictures?|pics?|imagery|visuals?)\b/i;

/**
 * Owner wants real photos *behind* / instead of plain text cards —
 * e.g. "put pictures in the background of them", "add photo backgrounds".
 * Distinct from a light Flux grade of an existing image.
 *
 * The photo noun must come FIRST and be followed closely by background/behind.
 * The old mirrored alternative ("background … photo") swallowed ordinary image
 * edits — "blur the background of that photo", "the background photo is too
 * dark", "crop the background out of this pic" — and those rejected every
 * pending draft.
 */
const PHOTO_BACKGROUND_ASK_RE =
  /\b((put|add|use|with|need|want)\s+)?(pictures?|photos?|pics?|imagery|stock|generated).{0,48}\b(background|behind|bg)\b|\bphoto[- ]?backgrounds?\b|\bpictures? (in|on) (the )?(background|back)\b/i;

/** Grading an image that already exists ("blur", "too dark", "crop"). */
const PHOTO_GRADE_RE =
  /\b(blur(?:ry|red)?|brighten|brighter|darken|darker|crop|zoom|sharpen|lighten|contrast|saturat\w*|warmer|cooler|too (?:dark|bright|busy|flat))\b/i;

/** An explicit "put/add/use photos" ask, which outranks any grade wording. */
const PHOTO_ADD_CUE_RE =
  /\b(put|add|use|swap in|need|want)\s+(?:some\s+|real\s+|actual\s+|a\s+|the\s+)?(pictures?|photos?|pics?|imagery|stock|generated)\b/i;

/** Owner explicitly wants designed/text cards rather than photos. */
export function looksLikeDesignedVisualsAsk(text: string | null | undefined): boolean {
  return DESIGNED_ONLY_RE.test(text ?? "");
}

/** Owner mentioned stock / AI / generated / photos. */
export function looksLikePhotoVisualsAsk(text: string | null | undefined): boolean {
  const t = text ?? "";
  if (looksLikeDesignedVisualsAsk(t)) return false;
  return PHOTO_ASK_RE.test(t) || looksLikePhotoBackgroundAsk(t);
}

/** Owner wants photographic backgrounds on drafts (not text-on-plain cards). */
export function looksLikePhotoBackgroundAsk(text: string | null | undefined): boolean {
  const t = text ?? "";
  if (looksLikeDesignedVisualsAsk(t)) return false;
  // A grade of an existing photo is an image edit, never a batch-wide redo.
  if (PHOTO_GRADE_RE.test(t) && !PHOTO_ADD_CUE_RE.test(t)) return false;
  return PHOTO_BACKGROUND_ASK_RE.test(t);
}

/**
 * Does the ask plainly cover the whole batch ("them", "all of them", "these")?
 * Only then may a photo-background redo reject every pending draft.
 */
const PHOTO_BACKGROUND_BATCH_RE =
  /\b(them|they|these|those|all|all of (?:them|these|those)|every|each|both|the (?:lot|batch|rest)|everything)\b/i;

export function photoBackgroundAskCoversBatch(text: string | null | undefined): boolean {
  return PHOTO_BACKGROUND_BATCH_RE.test(text ?? "");
}

/**
 * Infer visuals mode from freeform text.
 * Defaults to photo — Kip assumes photos unless the owner opts into text cards.
 */
export function inferVisualModeFromText(text: string | null | undefined): VisualMode {
  if (looksLikeDesignedVisualsAsk(text)) return "designed";
  return "photo";
}

/**
 * Resolve the visuals mode for a kickoff drain:
 * payload.visuals → brand.visual.preferred_visuals → photo default.
 */
export function resolveVisualMode(
  brand: Pick<Brand, "visual">,
  payload?: Record<string, unknown> | null,
): VisualMode {
  const raw = String(payload?.visuals ?? brand.visual?.preferred_visuals ?? "")
    .trim()
    .toLowerCase();
  if (
    raw === "designed" ||
    raw === "text" ||
    raw === "card" ||
    raw === "cards" ||
    raw === "graphic" ||
    raw === "graphics"
  ) {
    return "designed";
  }
  if (
    raw === "photo" ||
    raw === "photos" ||
    raw === "stock" ||
    raw === "generated" ||
    raw === "ai" ||
    raw === "synthetic"
  ) {
    return "photo";
  }
  return "photo";
}

/** Payload visuals value to persist + pass through the kickoff queue. */
export function visualsPayloadValue(mode: VisualMode, text?: string | null): string {
  if (mode === "designed") return "designed";
  const t = text ?? "";
  // Bare "AI" in a topic ("AI coding tools") is NOT a visuals mode — require
  // generated / ai-generated / synthetic cues.
  if (/\bstock\b/i.test(t) && !/\b(generated|ai[- ]?(generated|made|created)|synthetic)\b/i.test(t)) {
    return "stock";
  }
  if (/\b(generated|ai[- ]?(generated|made|created)|synthetic)\b/i.test(t)) return "generated";
  return "photo";
}

/** Merge preferred_visuals onto a VisualProfile. */
export function withPreferredVisuals(
  visual: VisualProfile | null | undefined,
  mode: VisualMode,
): VisualProfile {
  return { ...(visual ?? {}), preferred_visuals: mode };
}
