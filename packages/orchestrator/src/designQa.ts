import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { getMedia, type Brand } from "@pulse/shared";
import { callLLM } from "./llm.js";
import { listRecentDesignMemory } from "./designMemory.js";
import { gatherDesignContext, type LayoutPrimitive } from "./designComposer.js";

/**
 * Phase C8 — Design QA vision checklist before SMS.
 * Checks: legibility, brand tokens present, anti-clone vs last 3, niche-plausible.
 * Fail → caller recomposes once; still fail → honest SMS path (never ship broken type).
 */

export type DesignQaResult = {
  pass: boolean;
  reasons: string[];
  /** Suggested different layout when composition cloned last posts. */
  suggestLayout?: LayoutPrimitive;
};

type ContentPart = Exclude<Anthropic.MessageParam["content"], string>[number];

const LAYOUT_CYCLE: LayoutPrimitive[] = [
  "centered_stack",
  "bottom_band",
  "top_masthead",
  "numbered_tip",
  "split_offer",
  "editorial_quote",
];

/** Honest SMS when design still fails QA after one recompose. */
export function designQaFailureSms(brandName: string): string {
  return `I drafted something for ${brandName} but the graphic didn't clear my design check (legibility / on-brand / too similar to recent posts). Want me to try a different layout, or send a photo and I'll style that instead?`;
}

/**
 * Lightweight heuristic QA when vision is unavailable (tests / no media).
 * Fails empty text or obviously off-token notes.
 */
export function heuristicDesignQa(opts: {
  brand: Brand;
  slideTexts?: string[];
  recentLayoutKeys?: string[];
  thisLayoutKey?: string;
}): DesignQaResult {
  const reasons: string[] = [];
  const texts = opts.slideTexts ?? [];
  if (texts.some((t) => !t.trim())) reasons.push("empty slide copy");
  if (texts.some((t) => t.length > 160)) reasons.push("overflow risk — copy too long for card");

  const colors = opts.brand.visual?.colors ?? [];
  if (colors.length === 0) {
    // Soft warning only — defaults still apply; don't fail cold brands solely for this.
  }

  if (
    opts.thisLayoutKey &&
    opts.recentLayoutKeys &&
    opts.recentLayoutKeys.filter((k) => k === opts.thisLayoutKey).length >= 2
  ) {
    reasons.push("composition too similar to recent posts (anti-clone)");
  }

  const pass = reasons.length === 0;
  const suggestLayout = !pass
    ? LAYOUT_CYCLE.find((l) => l !== opts.thisLayoutKey) ?? "bottom_band"
    : undefined;
  return { pass, reasons, suggestLayout };
}

/**
 * Vision Design QA on the first slide (cover). Passes when checklist is green.
 */
export async function runDesignQa(opts: {
  brand: Brand;
  mediaIds: string[];
  slideTexts?: string[];
  layoutKey?: string;
}): Promise<DesignQaResult> {
  const ctx = await gatherDesignContext(opts.brand);
  const recentMem = await listRecentDesignMemory(opts.brand.id, 3).catch(() => []);

  // Always run heuristic first.
  const base = heuristicDesignQa({
    brand: opts.brand,
    slideTexts: opts.slideTexts,
    recentLayoutKeys: recentMem.map((m) => m.notes ?? "").filter(Boolean),
    thisLayoutKey: opts.layoutKey,
  });
  if (!base.pass && base.reasons.some((r) => r.startsWith("empty") || r.startsWith("overflow"))) {
    return base;
  }

  const coverId = opts.mediaIds[0];
  if (!coverId) {
    return { pass: false, reasons: ["no media to QA"], suggestLayout: "centered_stack" };
  }

  const blob = await getMedia(coverId);
  if (!blob) {
    // Can't vision-check — don't block SMS solely on missing blob if heuristic passed.
    return base.pass
      ? { pass: true, reasons: ["skipped vision — media missing; heuristic ok"] }
      : base;
  }

  try {
    const small = await sharp(Buffer.from(blob.bytes))
      .rotate()
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    const tokenBits = [
      opts.brand.visual?.colors?.length ? `colours ${opts.brand.visual.colors.join(", ")}` : "default palette",
      opts.brand.visual?.fonts?.length ? `fonts ${opts.brand.visual.fonts.join(", ")}` : "",
      opts.brand.visual?.aesthetic ? `aesthetic ${opts.brand.visual.aesthetic}` : "",
    ]
      .filter(Boolean)
      .join("; ");

    const system = [
      `You are Design QA for "${opts.brand.name}" social creatives.`,
      "Checklist — answer each as yes/no:",
      "1) LEGIBLE: headline/body readable, contrast ok, no overflow off edges",
      "2) BRAND_TOKENS: colours/type feel on-brand for: " + tokenBits,
      "3) ANTI_CLONE: composition is not a near-duplicate of a generic identical card (vary structure)",
      "4) NICHE_PLAUSIBLE: plausible for this business, not random AI sludge",
      ctx.coldStart ? `Cold-start note: ${ctx.bootstrapNotes}` : "",
      'Output ONLY JSON: {"pass":true|false,"reasons":["…"],"legible":true,"on_brand":true,"anti_clone":true,"niche_ok":true}',
      "Fail if illegible OR off-brand OR looks like a generic AI clone card.",
    ]
      .filter(Boolean)
      .join("\n");

    const content: ContentPart[] = [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } },
      {
        type: "text",
        text: `QA this cover slide.${opts.slideTexts?.length ? ` Slide copy: ${opts.slideTexts.slice(0, 5).join(" | ")}` : ""}`,
      },
    ];

    const raw = await callLLM({ system, messages: [{ role: "user", content }], maxTokens: 200 });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      pass?: boolean;
      reasons?: string[];
      legible?: boolean;
      on_brand?: boolean;
      anti_clone?: boolean;
      niche_ok?: boolean;
    };
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [];
    if (parsed.legible === false) reasons.push("illegible type/contrast");
    if (parsed.on_brand === false) reasons.push("off-brand tokens");
    if (parsed.anti_clone === false) reasons.push("clone-like composition");
    if (parsed.niche_ok === false) reasons.push("not niche-plausible");
    const pass = Boolean(parsed.pass) && reasons.length === 0;
    return {
      pass,
      reasons: pass ? ["ok"] : [...new Set(reasons)],
      suggestLayout: pass ? undefined : LAYOUT_CYCLE[(Date.now() + (opts.mediaIds.length || 0)) % LAYOUT_CYCLE.length],
    };
  } catch (err) {
    console.error("runDesignQa: vision failed, using heuristic", err);
    return base;
  }
}

/**
 * Run QA; on fail invoke `recompose` once and re-check.
 * Returns final QA + whether a recompose happened.
 */
export async function ensureDesignQa(opts: {
  brand: Brand;
  mediaIds: string[];
  slideTexts?: string[];
  layoutKey?: string;
  recompose: (suggest?: LayoutPrimitive) => Promise<{ mediaIds: string[]; layoutKey?: string }>;
}): Promise<{ qa: DesignQaResult; recomposed: boolean; mediaIds: string[] }> {
  let mediaIds = opts.mediaIds;
  let layoutKey = opts.layoutKey;
  let qa = await runDesignQa({
    brand: opts.brand,
    mediaIds,
    slideTexts: opts.slideTexts,
    layoutKey,
  });
  if (qa.pass) return { qa, recomposed: false, mediaIds };

  try {
    const next = await opts.recompose(qa.suggestLayout);
    mediaIds = next.mediaIds;
    layoutKey = next.layoutKey ?? layoutKey;
  } catch (err) {
    console.error("ensureDesignQa: recompose failed", err);
    return { qa: { pass: false, reasons: [...qa.reasons, "recompose failed"] }, recomposed: false, mediaIds };
  }

  qa = await runDesignQa({
    brand: opts.brand,
    mediaIds,
    slideTexts: opts.slideTexts,
    layoutKey,
  });
  return { qa, recomposed: true, mediaIds };
}
