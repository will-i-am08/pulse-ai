/**
 * Agent-chosen brand-kit language for generated posts.
 * Not a niche table: café vs founder-ops is decided in identity + draft_copy
 * from research + remembered likes, then passed here as elements / a brief directive.
 */

import type { VisualProfile } from "@pulse/shared";

export type FeedElementsMode = "none" | "mark" | "constructed";

export const FEED_ELEMENTS_INSTRUCTION =
  "Brand kit: honour elements:none (photo-led, do not stamp a logo), elements:mark (stamp the brand logo/wordmark), or elements:constructed (build the post from palette, type, and mark — no photo required). This is the brand's house style — do not mix photo-only and quote-card on the next slide. Do not map a niche to a template — the agent already chose from research, remembered likes, and visual tokens.";

function modeOf(v: unknown): FeedElementsMode | null {
  if (v === "none" || v === "mark" || v === "constructed") return v;
  return null;
}

/**
 * Resolve stamp vs constructed vs photo-led for a generated post.
 * Default is none (do not auto-stamp scraped logos). Explicit mark / constructed
 * still apply. Constructed also matches designed/graphics wording in the brief.
 */
export function resolveFeedElementsIntent(input: {
  brief?: string | null;
  elements?: unknown;
}): FeedElementsMode {
  const field = modeOf(input.elements);
  if (field) return field;

  const brief = (input.brief ?? "").replace(/\s+/g, " ").trim();
  if (!brief) return "none";

  if (/\belements:\s*none\b|\bno brand mark\b|\bno logo\b|\bnever stamp (the )?logo\b/i.test(brief)) {
    return "none";
  }
  if (/\belements:\s*constructed\b|\bconstructed from elements\b|\bgraphics? only\b|\bquote cards?\b|\btext cards?\b|\bdesigned (slides?|graphics?|cards?)\b/i.test(brief)) {
    return "constructed";
  }
  if (/\belements:\s*mark\b|\bbrand mark\b|\bstamp (the )?logo\b|\badd (our |the )?logo\b|\bwith (our |the )?logo\b/i.test(brief)) {
    return "mark";
  }
  return "none";
}

export function elementsOptsFromPayload(payload: Record<string, unknown> | null | undefined): {
  elements?: unknown;
} {
  if (!payload || payload.elements == null) return {};
  return { elements: payload.elements };
}

/** One pack line so the agent can pick a house style from tokens, not a niche table. */
export function formatBrandKitLine(visual?: VisualProfile | null): string {
  const v = visual ?? {};
  const bits = [
    v.colors?.length ? `colours ${v.colors.slice(0, 4).join(", ")}` : "",
    v.fonts?.length ? `fonts ${v.fonts.slice(0, 2).join(", ")}` : "",
    v.logo_url ? "logo yes" : "logo no",
    v.aesthetic ? `look ${v.aesthetic}` : "",
  ].filter(Boolean);
  return `Brand kit: ${bits.join("; ")}`;
}

export function formatMarketVisualsLine(
  exemplars: Array<{
    label?: string | null;
    notes?: string | null;
    competitor_name?: string | null;
    source?: string | null;
  }>,
): string | null {
  const bits: string[] = [];
  for (const ex of exemplars) {
    const label = (ex.label ?? "").replace(/\s+/g, " ").trim();
    const notes = (ex.notes ?? "").replace(/\s+/g, " ").trim();
    const who = (ex.competitor_name ?? "").replace(/\s+/g, " ").trim();
    const bit = [who, label || notes].filter(Boolean).join(" — ");
    if (bit) bits.push(bit);
    if (bits.length >= 3) break;
  }
  if (!bits.length) return null;
  return `Market visuals: ${bits.join("; ")}`;
}
