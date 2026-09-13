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
  /\b(stock|generated|ai[- ]?(generated|made|created)|synthetic|photos?|pics?|imagery|visuals?)\b/i;

/** Owner explicitly wants designed/text cards rather than photos. */
export function looksLikeDesignedVisualsAsk(text: string | null | undefined): boolean {
  return DESIGNED_ONLY_RE.test(text ?? "");
}

/** Owner mentioned stock / AI / generated / photos. */
export function looksLikePhotoVisualsAsk(text: string | null | undefined): boolean {
  const t = text ?? "";
  if (looksLikeDesignedVisualsAsk(t)) return false;
  return PHOTO_ASK_RE.test(t);
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
  if (/\bstock\b/i.test(t) && !/\b(generated|ai)\b/i.test(t)) return "stock";
  if (/\b(generated|ai)\b/i.test(t)) return "generated";
  return "photo";
}

/** Merge preferred_visuals onto a VisualProfile. */
export function withPreferredVisuals(
  visual: VisualProfile | null | undefined,
  mode: VisualMode,
): VisualProfile {
  return { ...(visual ?? {}), preferred_visuals: mode };
}
