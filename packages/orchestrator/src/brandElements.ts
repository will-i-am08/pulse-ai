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
  "Brand kit is IDENTITY and REQUEST-ONLY: honour elements:none (default — photo + overlay type, no logo/wordmark/badge), elements:mark (stamp logo or trading-name wordmark because the owner asked on THIS still, or you set this field), or elements:constructed (palette/type on a generated photo unless the brief is graphics-only / quote cards). Do not set mark or deco because this is an offer, announcement, or graphic moment. Do not auto-stamp from a lasting always-logo like. Kit fires only when the owner asked for the name/logo/mark on THIS still, or elements/deco is set. Decorative ornaments stay OPTIONAL and PER POST — default omit deco. When kit is on, it must point at the brand (logo, wordmark, palette) — never a nameless sticker, empty pill, or orphan colour bar. deco is only a vehicle for that mark. Type language can still repeat. Do not map a niche to a template — the agent already chose from research, remembered likes, and visual tokens.";

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

function phraseNegatedAt(brief: string, index: number): boolean {
  const window = brief.slice(Math.max(0, index - 80), index).toLowerCase();
  if (/\b(do not|don't|dont|never|without|no)\b/i.test(window)) return true;
  return /\b(no|not|not a|not the|without|without a|without the|skip|skip the|never|don't|dont|do not)\b[\s,:'"—-]*$/i.test(
    window.trimEnd(),
  );
}

function isKitRefusedBrief(brief: string): boolean {
  return /\b((do not|don't|dont|never)\b.{0,80}\b(name|logo|badge|wordmark|mark|sticker)\b|\bno (name|logo|badge|wordmark|sticker)s?\b.{0,40}\bon this|\bno brand mark\b|\bnever stamp\b|\btype only\b)/i.test(
    brief,
  );
}

/**
 * Owner asked for identity kit on THIS still (name, logo, wordmark, badge),
 * not overlay type and not a generic tart/hiring brief. Negation wins.
 */
export function briefAsksForIdentityKit(brief?: string | null, name?: string | null): boolean {
  const text = (brief ?? "").replace(/\s+/g, " ").trim();
  if (!text || isThisStillCleanBrief(text) || isKitRefusedBrief(text)) return false;
  const askRe =
    /\b(stamp (the |our |my )?(logo|mark|wordmark|name|badge)|add (our |the |my )?(logo|wordmark|name|badge|mark)|put (our |the |my )?(name|logo|wordmark|badge|mark)|with (our |the |my )?(logo|wordmark|name)|brand mark|elements:\s*mark|our (name|logo|wordmark) on|trading[- ]name|(logo|wordmark|name|badge) (on|onto) this)\b/gi;
  for (const m of text.matchAll(askRe)) {
    if (!phraseNegatedAt(text, m.index ?? 0)) return true;
  }
  const n = (name ?? "").replace(/\s+/g, " ").trim();
  if (n.length < 3) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(esc, "gi");
  for (const m of text.matchAll(named)) {
    if (phraseNegatedAt(text, m.index ?? 0)) continue;
    if (/\b(put|stamp|add|with)\b/i.test(text) && /\b(on|onto)\b/i.test(text)) return true;
  }
  return false;
}

/**
 * Resolve stamp vs constructed vs photo-led for a generated post.
 * Default is none (do not auto-stamp scraped logos or trading-name badges).
 * Explicit mark / constructed still apply. Constructed also matches
 * designed/graphics wording in the brief. Identity kit from the brief
 * only when they asked for the name/logo on THIS still.
 */
export function resolveFeedElementsIntent(input: {
  brief?: string | null;
  elements?: unknown;
  name?: string | null;
}): FeedElementsMode {
  const brief = (input.brief ?? "").replace(/\s+/g, " ").trim();
  if (brief && (isThisStillCleanBrief(brief) || isKitRefusedBrief(brief))) {
    return "none";
  }
  if (!brief) {
    const field = modeOf(input.elements);
    return field ?? "none";
  }

  if (/\belements:\s*none\b|\bno brand mark\b|\bno logo\b|\bnever stamp (the )?logo\b/i.test(brief)) {
    return "none";
  }
  if (/\belements:\s*constructed\b|\bconstructed from elements\b|\bgraphics? only\b|\bquote cards?\b|\btext cards?\b|\bdesigned (slides?|graphics?|cards?)\b/i.test(brief)) {
    return "constructed";
  }
  const field = modeOf(input.elements);
  if (field === "constructed") return "constructed";
  if (field === "none") return "none";
  if (briefAsksForIdentityKit(brief, input.name)) return "mark";
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
 * pick an identity vehicle (labeled mark), not empty chrome. Not a café table.
 */
export function suggestDecoPieces(
  visual?: { fonts?: string[]; colors?: string[]; aesthetic?: string; aesthetic_notes?: string } | null,
): DecoPiece[] {
  const lane = brandVisualLane(visual);
  if (lane === "editorial") return ["badge"];
  if (lane === "graphic") return ["badge"];
  if (lane === "industrial") return ["badge"];
  return ["sticker"];
}

/** Sticker/badge are vehicles for the trading name — never painted empty. */
export const IDENTITY_DECO_PIECES: DecoPiece[] = ["sticker", "badge"];

export function isIdentityDecoPiece(piece: DecoPiece): boolean {
  return piece === "sticker" || piece === "badge";
}

/** Any chosen kit must carry identity (logo/wordmark), not nameless SVG. */
export function decoNeedsIdentity(pieces: DecoPiece[]): boolean {
  return pieces.length > 0;
}

function isThisStillCleanBrief(brief: string): boolean {
  return (
    /\b(keep this (still|photo|shot|image|post) clean|type only|deco:\s*none|no decorations? on this|undecorated|plain photo)\b/i.test(
      brief,
    ) || isKitRefusedBrief(brief)
  );
}

function negatedBefore(brief: string, index: number): boolean {
  return phraseNegatedAt(brief, index);
}

function namedDecoPiecesFromBrief(brief: string): DecoPiece[] {
  const named: DecoPiece[] = [];
  const add = (piece: DecoPiece, re: RegExp) => {
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    const global = new RegExp(re.source, flags);
    for (const m of brief.matchAll(global)) {
      const at = m.index ?? 0;
      if (negatedBefore(brief, at)) continue;
      if (!named.includes(piece) && named.length < 4) named.push(piece);
      break;
    }
  };
  add("frame", /\b(frames?|inset frame|borders?)\b/i);
  add("corners", /\b(corners?|corner marks?|l-?corners?)\b/i);
  add("bar", /\b((colour|color|side|accent) bars?|add a bar)\b/i);
  add("rule", /\b(hairlines?|a rule|rules under)\b/i);
  add("underline", /\bunderlines?\b/i);
  add("shape", /\b(diamonds?|rotated squares?)\b/i);
  add("circle", /\b(circles?|rings?)\b/i);
  add("sticker", /\bstickers?\b/i);
  add("ribbon", /\bribbons?\b/i);
  add("dots", /\bdots\b/i);
  add("badge", /\bbadges?\b/i);
  return named;
}

function isGeneralCleanBrief(brief: string): boolean {
  return /\b(no decorations?|no ornaments?|keep (the )?(photos?|stills?) clean|deco:\s*none|undecorated|plain photo)\b/i.test(
    brief,
  );
}

function isDecorateAskBrief(brief: string): boolean {
  return /\b(decorate (this|it|the (still|photo|image|post))|add decorations?|ornaments?|canva[- ]style|graphic elements|decorative (kit|elements?))\b/i.test(
    brief,
  );
}

function decoPiecesFromBrief(brief: string): DecoPiece[] | null {
  const named = namedDecoPiecesFromBrief(brief);
  if (named.length) return named;
  if (isThisStillCleanBrief(brief) || isGeneralCleanBrief(brief)) return [];
  if (isDecorateAskBrief(brief)) return null;
  return [];
}

/**
 * Per-still ornaments. Default empty (clean photo). Owner-named pieces in the
 * brief win. "Keep THIS still clean" / type-only beats a confused deco field.
 * Otherwise the deco field, then a lane suggestion only when they asked to
 * decorate without naming pieces. Never implied by elements mark/constructed.
 */
export function resolveFeedDecoIntent(input: {
  brief?: string | null;
  deco?: unknown;
  visual?: { fonts?: string[]; colors?: string[]; aesthetic?: string; aesthetic_notes?: string } | null;
}): DecoPiece[] {
  const brief = (input.brief ?? "").replace(/\s+/g, " ").trim();
  if (brief && isThisStillCleanBrief(brief)) return [];
  const named = brief ? namedDecoPiecesFromBrief(brief) : [];
  if (named.length) return named;
  if (input.deco != null) {
    if (input.deco === "none" || input.deco === false) return [];
    return parseDecoPieces(input.deco);
  }
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
    mark: list.includes("badge") || list.includes("sticker") ? "badge" : "wordmark",
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
