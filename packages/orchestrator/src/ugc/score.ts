import { query } from "@pulse/shared";
import { callLLM } from "../llm.js";
import { PRESETS_V1 } from "./presets/index.js"; // locked v1 winners

export type UgcSceneScore = {
  phoneFeel: number;
  handsOk: number;
  productClear: number;
  notStudio: number;
  overall: number;
  notes: string;
  pass: boolean;
  /** False when no real image was graded — such rows must never drive a paid regen. */
  scored: boolean;
};

export type UgcAudioScore = {
  speechOk: boolean;
  tooFlat: boolean;
  notes: string;
  pass: boolean;
};

const PASS_THRESHOLD = 0.62;

export function hardGateUgc(opts: {
  hasProductRefs: boolean;
  requireProductRefs: boolean;
  /** REAL planned duration (sum of clamped scene seconds) — not a placeholder. */
  durationSec: number;
  hasVo: boolean;
  aigc: boolean;
}): { ok: boolean; reason?: string } {
  if (opts.requireProductRefs && !opts.hasProductRefs) {
    return { ok: false, reason: "product_refs_required" };
  }
  if (!opts.hasVo) return { ok: false, reason: "empty_vo" };
  if (!opts.aigc) return { ok: false, reason: "aigc_flag_missing" };
  const { minTotalSec, maxTotalSec } = PRESETS_V1.assembly;
  if (opts.durationSec < minTotalSec - 4 || opts.durationSec > maxTotalSec + 8) {
    return { ok: false, reason: "duration_out_of_range" };
  }
  return { ok: true };
}

/** Fail-open score: never triggers a paid regeneration, never pollutes the tune log. */
function unscored(notes: string): UgcSceneScore {
  return {
    phoneFeel: 0.7,
    handsOk: 0.7,
    productClear: 0.7,
    notStudio: 0.7,
    overall: 0.7,
    notes,
    pass: true,
    scored: false,
  };
}

/**
 * Grade a generated still. The IMAGE is the input — grading the prompt we wrote
 * ourselves produced no signal yet still paid for a full regeneration on the
 * verdict. Without image bytes this is a no-op that passes (spend safety).
 */
export async function scoreUgcStill(opts: {
  sceneRole: string;
  promptUsed: string;
  frameHint: string;
  /** The generated JPEG. Required — without it there is nothing to grade. */
  image?: Buffer | null;
}): Promise<UgcSceneScore> {
  if (!opts.image?.length) return unscored("no_image_supplied");
  try {
    const raw = await callLLM({
      system:
        "You score AI UGC stills for phone-native ads. Judge ONLY the attached image. Output ONLY JSON: " +
        '{"phoneFeel":0-1,"handsOk":0-1,"productClear":0-1,"notStudio":0-1,"notes":"…"}. ' +
        "Punish studio gloss, plastic skin, floating products, unreadable labels, any visible text/logos/watermarks.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: "image/jpeg" as const,
                data: opts.image.toString("base64"),
              },
            },
            {
              type: "text" as const,
              text: `Scene role: ${opts.sceneRole}\nIntended: ${opts.frameHint.slice(0, 300)}\nScore the attached image now.`,
            },
          ],
        },
      ],
      maxTokens: 200,
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<UgcSceneScore>;
    const phoneFeel = clamp01(Number(parsed.phoneFeel) || 0);
    const handsOk = clamp01(Number(parsed.handsOk) || 0.7);
    const productClear = clamp01(Number(parsed.productClear) || 0);
    const notStudio = clamp01(Number(parsed.notStudio) || 0);
    const overall = (phoneFeel + handsOk + productClear + notStudio) / 4;
    return {
      phoneFeel,
      handsOk,
      productClear,
      notStudio,
      overall,
      notes: String(parsed.notes ?? "").slice(0, 200),
      pass: overall >= PASS_THRESHOLD && productClear >= 0.5 && notStudio >= 0.5,
      scored: true,
    };
  } catch {
    // Scorer outage must not gate delivery — and must not buy a regeneration.
    return unscored("scorer_fallback");
  }
}

/** Rough VO delivery rate — used to keep the script inside the assembled runtime. */
const WORDS_PER_SECOND = 2.5;
/** 120 words was ~48s of VO for a ~12s video; cap to what the Reel can actually carry. */
export const MAX_SCRIPT_WORDS = Math.round(PRESETS_V1.assembly.maxTotalSec * WORDS_PER_SECOND);

export function scoreUgcAudioHeuristic(script: string): UgcAudioScore {
  const words = script.trim().split(/\s+/).filter(Boolean);
  const speechOk = words.length >= 12 && words.length <= MAX_SCRIPT_WORDS;
  const tooFlat = !/\.\.\.|—|--|honestly|okay so|like,/i.test(script) && !/[?]/.test(script);
  const banned = /\b(introducing|innovative|game-changer|revolutionize)\b/i.test(script);
  return {
    speechOk,
    tooFlat: tooFlat || banned,
    notes: banned
      ? "banned_ad_speak"
      : !speechOk
        ? `length_out_of_range (${words.length} words; max ${MAX_SCRIPT_WORDS})`
        : tooFlat
          ? "flat_monotone_risk"
          : "ok",
    pass: speechOk && !banned,
  };
}

export async function logUgcTune(opts: {
  brandId?: string | null;
  jobId?: string | null;
  presetId: string;
  sceneIndex?: number | null;
  scores: Record<string, unknown>;
  promptDelta?: Record<string, unknown>;
  passed: boolean;
}): Promise<void> {
  await query(
    `insert into ugc_tune_log (brand_id, job_id, preset_id, scene_index, scores, prompt_delta, passed)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      opts.brandId ?? null,
      opts.jobId ?? null,
      opts.presetId,
      opts.sceneIndex ?? null,
      JSON.stringify(opts.scores),
      JSON.stringify(opts.promptDelta ?? {}),
      opts.passed,
    ],
  ).catch(() => undefined);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** A UGC noun must be present — otherwise "try again" or "make it shorter"
 * about a caption buys a full-price video nobody asked for. */
const UGC_NOUN = /\b(ugc|reels?|videos?|ads?|clips?|creative)\b/i;
const RETUNE_VERB =
  /\b(more casual|shorter|different hook|less face|more product|try again|regenerate|redo|remake|another go)\b/i;

export function looksLikeUgcRetune(body: string | null | undefined): boolean {
  if (!body) return false;
  return RETUNE_VERB.test(body) && UGC_NOUN.test(body);
}

export type UgcRetuneHint =
  | "more_casual"
  | "shorter"
  | "different_hook"
  | "less_face"
  | "more_product"
  | "redo";

export function parseUgcRetune(body: string): UgcRetuneHint {
  const t = body.toLowerCase();
  if (/more casual/.test(t)) return "more_casual";
  if (/shorter/.test(t)) return "shorter";
  if (/different hook/.test(t)) return "different_hook";
  if (/less face/.test(t)) return "less_face";
  if (/more product/.test(t)) return "more_product";
  return "redo";
}

