/**
 * Agent-chosen brand-kit language for generated posts.
 * Construction (photo vs mark vs constructed) can stay brand-true.
 * Decorative ornaments are optional and per still — default photos clean.
 * Not a niche table: café vs founder-ops is decided in identity + draft_copy
 * from research + remembered likes, then passed here as elements / deco / a brief directive.
 */

import type { VisualProfile } from "@pulse/shared";
import { looksLikeDesignedVisualsAsk } from "./visualMode.js";

export type FeedElementsMode = "none" | "mark" | "constructed";

/** Token-derived visual lane — fonts / aesthetic / palette, never a niche name. */
export type BrandVisualLane = "editorial" | "graphic" | "minimal" | "industrial";

export const DECO_PIECES = [
  "frame",
  "corners",
  "bar",
  "rule",
  "underline",
  "shape",
  "circle",
  "sticker",
  "ribbon",
  "dots",
  "badge",
] as const;
export type DecoPiece = (typeof DECO_PIECES)[number];
export type MarkPlacement = "wordmark" | "badge";

export type BrandDecoKit = {
  lane: BrandVisualLane;
  pieces: DecoPiece[];
  mark: MarkPlacement;
};

export const FEED_ELEMENTS_INSTRUCTION =
  "Brand kit: honour elements:none (photo-led), elements:mark (stamp logo/wordmark on THIS still), or elements:constructed (build from palette and type on a generated photo unless the brief is graphics-only / quote cards). Decorative ornaments are OPTIONAL and PER POST — default the photo clean. Only add ornaments when this still needs them or the owner asked. Set deco to pieces from the vocabulary (frame, corners, bar, rule, underline, shape, circle, sticker, ribbon, dots, badge) that fit visual tokens — not only L-corners, not a café=template table, not the same kit on every photo, not a random mix to vary the grid. Type language can still repeat. Do not map a niche to a template — the agent already chose from research, remembered likes, and visual tokens.";

const DECO_SET = new Set<string>(DECO_PIECES);

function modeOf(v: unknown): FeedElementsMode | null {
  if (v === "none" || v === "mark" || v === "constructed") return v;
  return null;
}

export function parseDecoPieces(raw: unknown): DecoPiece[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  const out: DecoPiece[] = [];
  for (const item of list) {
    const key = String(item).trim().toLowerCase();
    if (!DECO_SET.has(key)) continue;
    const piece = key as DecoPiece;
    if (!out.includes(piece)) out.push(piece);
    if (out.length >= 4) break;
  }
  return out;
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
 * When the owner/agent asked to decorate this still without naming pieces,
 * pick a short lane-true set. Not corners-only. Not a café table.
 */
export function suggestDecoPieces(
  visual?: { fonts?: string[]; colors?: string[]; aesthetic?: string; aesthetic_notes?: string } | null,
): DecoPiece[] {
  const lane = brandVisualLane(visual);
  if (lane === "editorial") return ["frame", "underline", "rule"];
  if (lane === "graphic") return ["bar", "sticker", "badge"];
  if (lane === "industrial") return ["bar", "ribbon", "frame"];
  return ["underline", "rule", "dots"];
}

function decoPiecesFromBrief(brief: string): DecoPiece[] | null {
  if (
    /\b(no decorations?|no ornaments?|keep (the )?(photos?|stills?) clean|deco:\s*none|undecorated|plain photo)\b/i.test(
      brief,
    )
  ) {
    return [];
  }
  const named: DecoPiece[] = [];
  const add = (piece: DecoPiece) => {
    if (!named.includes(piece) && named.length < 4) named.push(piece);
  };
  if (/\b(frames?|inset frame|borders?)\b/i.test(brief)) add("frame");
  if (/\b(corners?|corner marks?|l-?corners?)\b/i.test(brief)) add("corners");
  if (/\b((colour|color|side|accent) bars?|add a bar)\b/i.test(brief)) add("bar");
  if (/\b(hairlines?|a rule|rules under)\b/i.test(brief)) add("rule");
  if (/\bunderlines?\b/i.test(brief)) add("underline");
  if (/\b(diamonds?|rotated squares?)\b/i.test(brief)) add("shape");
  if (/\b(circles?|rings?)\b/i.test(brief)) add("circle");
  if (/\bstickers?\b/i.test(brief)) add("sticker");
  if (/\bribbons?\b/i.test(brief)) add("ribbon");
  if (/\bdots\b/i.test(brief)) add("dots");
  if (/\bbadges?\b/i.test(brief)) add("badge");
  if (named.length) return named;
  if (
    /\b(decorate (this|it|the (still|photo|image|post))|add decorations?|ornaments?|canva[- ]style|graphic elements|decorative (kit|elements?))\b/i.test(
      brief,
    )
  ) {
    return null;
  }
  return [];
}

/**
 * Per-still ornaments. Default empty (clean photo). Field wins, then named
 * pieces in the brief, then a lane suggestion only when they asked to decorate
 * without naming pieces. Never implied by elements mark/constructed.
 */
export function resolveFeedDecoIntent(input: {
  brief?: string | null;
  deco?: unknown;
  visual?: { fonts?: string[]; colors?: string[]; aesthetic?: string; aesthetic_notes?: string } | null;
}): DecoPiece[] {
  if (input.deco != null) {
    if (input.deco === "none" || input.deco === false) return [];
    return parseDecoPieces(input.deco);
  }
  const brief = (input.brief ?? "").replace(/\s+/g, " ").trim();
  if (!brief) return [];
  const fromBrief = decoPiecesFromBrief(brief);
  if (fromBrief === null) return suggestDecoPieces(input.visual);
  return fromBrief;
}

/**
 * Kit for THIS still from explicit pieces. Empty pieces → no ornaments.
 * Badge in the list chooses badge mark placement; other pieces paint.
 */
export function resolveBrandDecoKit(
  visual?: VisualProfile | null,
  pieces: DecoPiece[] | FeedElementsMode = [],
): BrandDecoKit | null {
  // Back-compat: old callers passed elements mode. Mode no longer implies a kit.
  if (pieces === "none" || pieces === "mark" || pieces === "constructed") return null;
  const list = Array.isArray(pieces) ? pieces.filter((p, i, all) => DECO_SET.has(p) && all.indexOf(p) === i) : [];
  if (!list.length) return null;
  const lane = brandVisualLane(visual);
  return {
    lane,
    pieces: list,
    mark: list.includes("badge") ? "badge" : "wordmark",
  };
}

export function elementsOptsFromPayload(payload: Record<string, unknown> | null | undefined): {
  elements?: unknown;
  deco?: unknown;
} {
  if (!payload) return {};
  const out: { elements?: unknown; deco?: unknown } = {};
  if (payload.elements != null) out.elements = payload.elements;
  if (payload.deco != null) out.deco = payload.deco;
  return out;
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
