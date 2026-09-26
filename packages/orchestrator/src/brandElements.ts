/**
 * Agent-chosen brand-kit language for generated posts.
 * Not a niche table: café vs founder-ops is decided in identity + draft_copy
 * from research + remembered likes, then passed here as elements / a brief directive.
 */

import type { VisualProfile } from "@pulse/shared";
import { looksLikeDesignedVisualsAsk } from "./visualMode.js";

export type FeedElementsMode = "none" | "mark" | "constructed";

/** Token-derived visual lane — fonts / aesthetic / palette, never a niche name. */
export type BrandVisualLane = "editorial" | "graphic" | "minimal" | "industrial";

export type DecoPiece = "frame" | "corners" | "bar" | "rule" | "shape";
export type MarkPlacement = "wordmark" | "badge";

export type BrandDecoKit = {
  lane: BrandVisualLane;
  pieces: DecoPiece[];
  mark: MarkPlacement;
};

export const FEED_ELEMENTS_INSTRUCTION =
  "Brand kit: honour elements:none (photo-led, do not stamp a logo or decoration), elements:mark (stamp the brand logo/wordmark plus this brand's decorative kit — frames, corner marks, colour bars, badges, shapes), or elements:constructed (build from palette, type, mark, and the same kit on a generated photo unless the brief is graphics-only / quote cards). Kit pieces come from visual tokens (fonts, aesthetic, palette), not a café=template table. This is the brand's house style — do not mix photo-only and quote-card on the next slide. Do not map a niche to a template — the agent already chose from research, remembered likes, and visual tokens.";

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

/** Constructed is kit-on-photo unless the owner asked for type-only cards. */
export function constructedWantsPhoto(brief?: string | null): boolean {
  return !looksLikeDesignedVisualsAsk(brief);
}

/**
 * House visual lane from stored tokens. Not café vs tech — serif/editorial notes
 * land editorial, display/poster notes land graphic, named sans/minimal land
 * minimal, utilitarian/technical notes land industrial. Empty tokens stay
 * minimal (quiet Inter) so a missing scrape does not invent a poster kit.
 */
export function brandVisualLane(
  visual?: { fonts?: string[]; colors?: string[]; aesthetic?: string; aesthetic_notes?: string } | null,
): BrandVisualLane {
  const fonts = (visual?.fonts ?? []).map((f) => f.toLowerCase()).join(" ");
  const aesthetic = `${visual?.aesthetic ?? ""} ${visual?.aesthetic_notes ?? ""}`.toLowerCase();
  const blob = `${fonts} ${aesthetic}`.trim();

  if (/serif|playfair|georgia|garamond|times|didot|bodoni|editorial|magazine/.test(blob)) {
    return "editorial";
  }
  if (/anton|impact|bebas|display|condensed|oswald|archivo black|poster|loud|shouty|graphic/.test(blob)) {
    return "graphic";
  }
  if (/industrial|technical|utilitarian|mono|grotesk|machine/.test(blob)) {
    return "industrial";
  }
  if (
    /sans|helvetica|arial|montserrat|inter|futura|gothic|roboto|open sans|lato|poppins|dm sans|neue|linear|minimal|clean/.test(
      blob,
    )
  ) {
    return "minimal";
  }

  const colors = (visual?.colors ?? []).join(" ").toLowerCase();
  if (/(#0|#1|#141414|black|charcoal|navy)/.test(colors) && /(#f|#e|cream|white)/.test(colors)) {
    return "industrial";
  }
  return "minimal";
}

/**
 * Brand-stable decorative kit. Intensity follows elements (mark = light,
 * constructed = fuller). Same lane → same pieces on every post.
 */
export function resolveBrandDecoKit(
  visual?: VisualProfile | null,
  mode: FeedElementsMode = "none",
): BrandDecoKit | null {
  if (mode === "none") return null;
  const lane = brandVisualLane(visual);
  const full = mode === "constructed";
  if (lane === "editorial") {
    return { lane, pieces: full ? ["frame", "rule", "corners"] : ["rule", "corners"], mark: "wordmark" };
  }
  if (lane === "graphic") {
    return { lane, pieces: full ? ["bar", "corners", "shape"] : ["bar", "shape"], mark: "badge" };
  }
  if (lane === "industrial") {
    return { lane, pieces: full ? ["bar", "frame", "shape"] : ["bar"], mark: full ? "badge" : "wordmark" };
  }
  return { lane, pieces: full ? ["corners", "bar"] : ["corners"], mark: "wordmark" };
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
    `lane ${brandVisualLane(v)}`,
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
