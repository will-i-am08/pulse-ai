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
 *
 * mode "photo_overlay" (photo + burned-in text carousels): legible overlays with
 * edge margin, non-slop photo, idea specificity, anti-clone. Samples cover + mid.
 */

export type DesignQaMode = "designed" | "photo_overlay";

export type DesignQaFixHints = {
  shortenOverlay?: boolean;
  strongerPhoto?: boolean;
  reason?: string;
};

export type DesignQaResult = {
  pass: boolean;
  reasons: string[];
  /** Suggested different layout when composition cloned last posts. */
  suggestLayout?: LayoutPrimitive;
  /** Optional recompose hints from vision (photo_overlay path). */
  fixHints?: DesignQaFixHints;
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

/** Max copy length before heuristic overflow — overlays need tighter budgets. */
function overflowLimit(mode: DesignQaMode): number {
  return mode === "photo_overlay" ? 120 : 160;
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
  mode?: DesignQaMode;
}): DesignQaResult {
  const mode = opts.mode ?? "designed";
  const reasons: string[] = [];
  const texts = opts.slideTexts ?? [];
  if (texts.some((t) => !t.trim())) reasons.push("empty slide copy");
  const maxLen = overflowLimit(mode);
  if (texts.some((t) => t.length > maxLen)) {
    reasons.push(
      mode === "photo_overlay"
        ? "overflow risk — overlay copy too long for photo"
        : "overflow risk — copy too long for card",
    );
  }

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

  const fixHints: DesignQaFixHints | undefined = !pass
    ? {
        shortenOverlay: reasons.some((r) => r.includes("overflow")),
        strongerPhoto: false,
        reason: reasons[0],
      }
    : undefined;

  return { pass, reasons, suggestLayout, ...(fixHints ? { fixHints } : {}) };
}

/** Indices to vision-sample: cover only, or cover + mid when ≥3 slides. */
export function designQaSampleIndices(mediaCount: number): number[] {
  if (mediaCount <= 0) return [];
  if (mediaCount < 3) return [0];
  const mid = Math.floor(mediaCount / 2);
  return mid === 0 ? [0] : [0, mid];
}

function parseFixHints(raw: unknown): DesignQaFixHints | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const hints: DesignQaFixHints = {};
  if (typeof o.shortenOverlay === "boolean") hints.shortenOverlay = o.shortenOverlay;
  if (typeof o.strongerPhoto === "boolean") hints.strongerPhoto = o.strongerPhoto;
  if (typeof o.reason === "string" && o.reason.trim()) hints.reason = o.reason.trim();
  return Object.keys(hints).length ? hints : undefined;
}

/**
 * Vision Design QA on cover (and mid slide for photo_overlay when ≥3 media).
 */
export async function runDesignQa(opts: {
  brand: Brand;
  mediaIds: string[];
  slideTexts?: string[];
  layoutKey?: string;
  mode?: DesignQaMode;
}): Promise<DesignQaResult> {
  const mode = opts.mode ?? "designed";
  const ctx = await gatherDesignContext(opts.brand);
  const recentMem = await listRecentDesignMemory(opts.brand.id, 3).catch(() => []);

  // Always run heuristic first.
  const base = heuristicDesignQa({
    brand: opts.brand,
    slideTexts: opts.slideTexts,
    recentLayoutKeys: recentMem.map((m) => m.notes ?? "").filter(Boolean),
    thisLayoutKey: opts.layoutKey,
    mode,
  });
  if (!base.pass && base.reasons.some((r) => r.startsWith("empty") || r.startsWith("overflow"))) {
    return base;
  }

  const sampleIdx = designQaSampleIndices(opts.mediaIds.length);
  if (!sampleIdx.length) {
    return { pass: false, reasons: ["no media to QA"], suggestLayout: "centered_stack" };
  }

  const imageParts: ContentPart[] = [];
  for (const idx of sampleIdx) {
    const id = opts.mediaIds[idx];
    if (!id) continue;
    const blob = await getMedia(id);
    if (!blob) continue;
    try {
      const small = await sharp(Buffer.from(blob.bytes))
        .rotate()
        .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
      imageParts.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") },
      });
    } catch {
      /* skip bad frame */
    }
  }

  if (!imageParts.length) {
    // Can't vision-check — don't block SMS solely on missing blob if heuristic passed.
    return base.pass
      ? { pass: true, reasons: ["skipped vision — media missing; heuristic ok"] }
      : base;
  }

  try {
    const tokenBits = [
      opts.brand.visual?.colors?.length ? `colours ${opts.brand.visual.colors.join(", ")}` : "default palette",
      opts.brand.visual?.fonts?.length ? `fonts ${opts.brand.visual.fonts.join(", ")}` : "",
      opts.brand.visual?.aesthetic ? `aesthetic ${opts.brand.visual.aesthetic}` : "",
    ]
      .filter(Boolean)
      .join("; ");

    const checklist =
      mode === "photo_overlay"
        ? [
            "Checklist — answer each as yes/no:",
            "1) LEGIBLE: burned-in text readable with clear edge margin (not clipped / overflowing frame)",
            "2) PHOTO_QUALITY: photo looks real and niche-specific — not generic AI-slop stock",
            "3) IDEA_SPECIFICITY: if slide texts look like ideas/titles, they feel concrete (not vague fluff)",
            "4) ANTI_CLONE: composition is not a near-duplicate of a generic identical overlay card",
            "5) BRAND_FIT: feel on-brand for: " + tokenBits,
          ]
        : [
            "Checklist — answer each as yes/no:",
            "1) LEGIBLE: headline/body readable, contrast ok, no overflow off edges",
            "2) BRAND_TOKENS: colours/type feel on-brand for: " + tokenBits,
            "3) ANTI_CLONE: composition is not a near-duplicate of a generic identical card (vary structure)",
            "4) NICHE_PLAUSIBLE: plausible for this business, not random AI sludge",
          ];

    const jsonShape =
      mode === "photo_overlay"
        ? 'Output ONLY JSON: {"pass":true|false,"reasons":["…"],"legible":true,"photo_ok":true,"idea_specific":true,"anti_clone":true,"on_brand":true,"fixHints":{"shortenOverlay":false,"strongerPhoto":false,"reason":""}}'
        : 'Output ONLY JSON: {"pass":true|false,"reasons":["…"],"legible":true,"on_brand":true,"anti_clone":true,"niche_ok":true}';

    const system = [
      `You are Design QA for "${opts.brand.name}" social creatives${mode === "photo_overlay" ? " (photo + text overlay carousel)" : ""}.`,
      ...checklist,
      ctx.coldStart ? `Cold-start note: ${ctx.bootstrapNotes}` : "",
      jsonShape,
      mode === "photo_overlay"
        ? "Fail if illegible/clipped overlay OR AI-slop photo OR vague idea copy OR clone-like frame. Set fixHints.shortenOverlay when text overflows; fixHints.strongerPhoto when the photo is weak/generic."
        : "Fail if illegible OR off-brand OR looks like a generic AI clone card.",
    ]
      .filter(Boolean)
      .join("\n");

    const label =
      mode === "photo_overlay" && imageParts.length > 1
        ? "QA these slides (cover + mid)."
        : "QA this cover slide.";

    const content: ContentPart[] = [
      ...imageParts,
      {
        type: "text",
        text: `${label}${opts.slideTexts?.length ? ` Slide copy: ${opts.slideTexts.slice(0, 5).join(" | ")}` : ""}`,
      },
    ];

    const raw = await callLLM({ system, messages: [{ role: "user", content }], maxTokens: 280 });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as {
      pass?: boolean;
      reasons?: string[];
      legible?: boolean;
      on_brand?: boolean;
      anti_clone?: boolean;
      niche_ok?: boolean;
      photo_ok?: boolean;
      idea_specific?: boolean;
      fixHints?: unknown;
    };
    const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.map(String) : [];
    if (parsed.legible === false) reasons.push("illegible type/contrast");
    if (parsed.on_brand === false) reasons.push("off-brand tokens");
    if (parsed.anti_clone === false) reasons.push("clone-like composition");
    if (mode === "photo_overlay") {
      if (parsed.photo_ok === false) reasons.push("photo looks AI-slop / generic");
      if (parsed.idea_specific === false) reasons.push("idea copy too vague");
    } else if (parsed.niche_ok === false) {
      reasons.push("not niche-plausible");
    }

    let fixHints = parseFixHints(parsed.fixHints);
    if (!fixHints && reasons.length) {
      const joined = reasons.join(" ").toLowerCase();
      fixHints = {
        shortenOverlay: /illegib|overflow|clip|margin|too long/.test(joined),
        strongerPhoto: /photo|slop|generic|niche|ai-slop|ai sludge/.test(joined),
        reason: reasons[0],
      };
    }

    const pass = Boolean(parsed.pass) && reasons.length === 0;
    return {
      pass,
      reasons: pass ? ["ok"] : [...new Set(reasons)],
      suggestLayout: pass ? undefined : LAYOUT_CYCLE[(Date.now() + (opts.mediaIds.length || 0)) % LAYOUT_CYCLE.length],
      ...(fixHints && !pass ? { fixHints } : {}),
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
  mode?: DesignQaMode;
  recompose: (
    suggest?: LayoutPrimitive,
    fixHints?: DesignQaFixHints,
  ) => Promise<{ mediaIds: string[]; layoutKey?: string }>;
}): Promise<{ qa: DesignQaResult; recomposed: boolean; mediaIds: string[] }> {
  const mode = opts.mode ?? "designed";
  let mediaIds = opts.mediaIds;
  let layoutKey = opts.layoutKey;
  let qa = await runDesignQa({
    brand: opts.brand,
    mediaIds,
    slideTexts: opts.slideTexts,
    layoutKey,
    mode,
  });
  if (qa.pass) return { qa, recomposed: false, mediaIds };

  try {
    const next = await opts.recompose(qa.suggestLayout, qa.fixHints);
    mediaIds = next.mediaIds;
    layoutKey = next.layoutKey ?? layoutKey;
  } catch (err) {
    console.error("ensureDesignQa: recompose failed", err);
    return { qa: { pass: false, reasons: [...qa.reasons, "recompose failed"], fixHints: qa.fixHints }, recomposed: false, mediaIds };
  }

  qa = await runDesignQa({
    brand: opts.brand,
    mediaIds,
    slideTexts: opts.slideTexts,
    layoutKey,
    mode,
  });
  return { qa, recomposed: true, mediaIds };
}
