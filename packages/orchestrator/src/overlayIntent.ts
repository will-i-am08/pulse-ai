/**
 * Agent-chosen on-image type for generated feed stills.
 * Not a niche table: café vs founder-ops is decided in identity + draft_copy,
 * then passed here as overlay / overlay_tone / a brief directive.
 */

import {
  extractExactOverlayHeadline,
  messageWantsNoText,
  messageWantsText,
  type OverlayTreatment,
} from "./imaging.js";

export type FeedOverlayMode = "none" | "headline";
export type FeedOverlayTone = "quiet" | "shouty";

export type FeedOverlayIntent = {
  mode: FeedOverlayMode;
  tone: FeedOverlayTone;
  exactHeadline: string | null;
};

/** Bottom band, one line, Inter — not the stacked Anton poster. */
export const QUIET_OVERLAY_TREATMENT: OverlayTreatment = {
  placement: "bottom",
  stack: "single",
  face: "inter",
  wrap: "banner",
};

export const FEED_OVERLAY_INSTRUCTION =
  "On-image type: honour overlay:none (clean photo, card may be empty) or overlay:headline (card is the on-image line). Quiet = one short line, not a stacked shout. Shouty = punchy 2–5 words. This is the brand's house style — do not mix clean and poster on the next slide. Do not map a niche to overlay vs clean — the agent already chose from brand facts, voice, and design rules.";

function modeOf(v: unknown): FeedOverlayMode | null {
  if (v === "none" || v === "headline") return v;
  return null;
}

function toneOf(v: unknown): FeedOverlayTone | null {
  if (v === "quiet" || v === "shouty") return v;
  return null;
}

function namedHeadline(input: {
  brief: string;
  overlay_headline?: unknown;
}): string | null {
  if (typeof input.overlay_headline === "string" && input.overlay_headline.trim()) {
    return input.overlay_headline.trim();
  }
  return extractExactOverlayHeadline(input.brief);
}

function toneFromBrief(brief: string, explicit: FeedOverlayTone | null): FeedOverlayTone {
  if (explicit) return explicit;
  if (/\boverlay(?:_tone)?:\s*quiet\b|\bquiet overlay\b|\bquiet line\b/i.test(brief)) return "quiet";
  if (/\boverlay(?:_tone)?:\s*shouty\b|\bshouty overlay\b|\bpunchy poster\b/i.test(brief)) {
    return "shouty";
  }
  return "shouty";
}

/**
 * Resolve overlay vs clean for a generated feed still.
 * Default is none (stop always-tiling). Explicit headline / owner-named
 * overlay / "add text" still burn type.
 */
export function resolveFeedOverlayIntent(input: {
  brief?: string | null;
  overlay?: unknown;
  overlay_tone?: unknown;
  overlay_headline?: unknown;
}): FeedOverlayIntent {
  const brief = (input.brief ?? "").replace(/\s+/g, " ").trim();
  const exactHeadline = namedHeadline({ brief, overlay_headline: input.overlay_headline });
  const tone = toneFromBrief(brief, toneOf(input.overlay_tone));
  const field = modeOf(input.overlay);

  if (field === "none") return { mode: "none", tone, exactHeadline: null };
  if (field === "headline") return { mode: "headline", tone, exactHeadline };

  if (/\boverlay:\s*quiet\b/i.test(brief)) {
    return { mode: "headline", tone: "quiet", exactHeadline };
  }
  if (/\boverlay:\s*shouty\b/i.test(brief)) {
    return { mode: "headline", tone: "shouty", exactHeadline };
  }

  if (messageWantsNoText(brief) || /\bno overlay\b|\boverlay:\s*none\b/i.test(brief)) {
    return { mode: "none", tone, exactHeadline: null };
  }

  if (exactHeadline) return { mode: "headline", tone, exactHeadline };

  if (messageWantsText(brief) || /\boverlay:\s*headline\b/i.test(brief)) {
    return { mode: "headline", tone, exactHeadline };
  }

  return { mode: "none", tone, exactHeadline: null };
}

export function overlayOptsFromPayload(payload: Record<string, unknown> | null | undefined): {
  overlay?: unknown;
  overlay_tone?: unknown;
  overlay_headline?: unknown;
} {
  if (!payload) return {};
  return {
    overlay: payload.overlay,
    overlay_tone: payload.overlay_tone,
    overlay_headline: payload.overlay_headline,
  };
}
