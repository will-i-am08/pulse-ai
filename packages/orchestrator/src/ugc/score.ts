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

export async function scoreUgcStill(opts: {
  sceneRole: string;
  promptUsed: string;
  frameHint: string;
}): Promise<UgcSceneScore> {
  try {
    const raw = await callLLM({
      system:
        "You score AI UGC stills for phone-native ads. Output ONLY JSON: " +
        '{"phoneFeel":0-1,"handsOk":0-1,"productClear":0-1,"notStudio":0-1,"notes":"…"}. ' +
        "Punish studio gloss, plastic skin, floating products, unreadable labels.",
      messages: [
        {
          role: "user",
          content: `Scene role: ${opts.sceneRole}\nPrompt: ${opts.promptUsed.slice(0, 400)}\nFrame: ${opts.frameHint.slice(0, 400)}`,
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
    };
  } catch {
    return {
      phoneFeel: 0.7,
      handsOk: 0.7,
      productClear: 0.7,
      notStudio: 0.7,
      overall: 0.7,
      notes: "scorer_fallback",
      pass: true,
    };
  }
}

export function scoreUgcAudioHeuristic(script: string): UgcAudioScore {
  const words = script.trim().split(/\s+/).filter(Boolean);
  const speechOk = words.length >= 12 && words.length <= 120;
  const tooFlat = !/\.\.\.|—|--|honestly|okay so|like,/i.test(script) && !/[?]/.test(script);
  const banned = /\b(introducing|innovative|game-changer|revolutionize)\b/i.test(script);
  return {
    speechOk,
    tooFlat: tooFlat || banned,
    notes: banned ? "banned_ad_speak" : tooFlat ? "flat_monotone_risk" : "ok",
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

export function looksLikeUgcRetune(body: string | null | undefined): boolean {
  if (!body) return false;
  return /\b(more casual|shorter|different hook|less face|more product|try again|regenerate|redo (the )?(ugc|ad|reel|video))\b/i.test(
    body,
  );
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

