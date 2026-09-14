/**
 * Smart Kip Phase 4 — thin multi-step planner.
 * Produces a short JSON plan before kickoff work. Not a free-form agent.
 * Never publishes; never invents ad spend.
 */

import {
  KipKickoffKind,
  getServerEnv,
  type Brand,
  type KipKickoffKind as KipKickoffKindT,
} from "@pulse/shared";
import { callLLM } from "./llm.js";
import { kipMemoryPromptBlock } from "./kipMemory.js";
import { personaLines } from "./persona.js";

export type SmartPlanStep = { action: string; detail?: string };

export type SmartPlan = {
  goal: string;
  steps: SmartPlanStep[];
  kickoffKind?: KipKickoffKindT | null;
  speakHint?: string;
  confidence: number;
};

const KIND_SET = new Set<string>(KipKickoffKind);

const WORK_VERB =
  /\b(draft|make|create|research|plan|schedule|write|post|scout|check|build|propose|prepare|carousel|batch)\b/i;

/** Heuristic: only invoke the planner for clearly multi-step asks. Keep narrow. */
export function looksLikeMultiStepAsk(body: string | null | undefined): boolean {
  if (!body?.trim()) return false;
  const t = body.trim();
  if (/\b(then|and also|after that|plus|first\b.+\bthen\b|as well as)\b/i.test(t)) {
    return WORK_VERB.test(t);
  }
  const andCount = (t.match(/\band\b/gi) ?? []).length;
  if (andCount >= 2 && WORK_VERB.test(t)) return true;
  // Long asks only if they mention content/work.
  return t.length >= 80 && WORK_VERB.test(t);
}

/** @deprecated alias — prefer looksLikeMultiStepAsk */
export const looksLikeMultiStepJob = looksLikeMultiStepAsk;

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Parse model JSON into a SmartPlan. Returns null when invalid or low confidence.
 */
export function parseSmartPlan(raw: string, minConfidence = 0.45): SmartPlan | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  const goal = typeof rec.goal === "string" ? clip(rec.goal, 200) : "";
  if (!goal) return null;

  const confidenceRaw = typeof rec.confidence === "number" ? rec.confidence : Number(rec.confidence);
  const confidence =
    Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw)) : 0;
  if (confidence < minConfidence) return null;

  const stepsIn = Array.isArray(rec.steps) ? rec.steps : [];
  const steps: SmartPlanStep[] = [];
  for (const s of stepsIn.slice(0, 4)) {
    if (!s || typeof s !== "object") continue;
    const row = s as Record<string, unknown>;
    const action = typeof row.action === "string" ? clip(row.action, 120) : "";
    if (!action) continue;
    const detail = typeof row.detail === "string" ? clip(row.detail, 160) : undefined;
    steps.push(detail ? { action, detail } : { action });
  }
  if (!steps.length) return null;

  let kickoffKind: KipKickoffKindT | null = null;
  if (typeof rec.kickoffKind === "string" && KIND_SET.has(rec.kickoffKind)) {
    kickoffKind = rec.kickoffKind as KipKickoffKindT;
  } else if (rec.kickoffKind === null) {
    kickoffKind = null;
  }

  const speakHint =
    typeof rec.speakHint === "string" && rec.speakHint.trim()
      ? clip(rec.speakHint, 280)
      : undefined;

  return { goal, steps, kickoffKind, speakHint, confidence };
}

/**
 * Ask the smart-tier model for a short plan. Returns null when the flag is off,
 * the model fails, or the plan is invalid / low confidence.
 */
export async function planSmartTurn(input: {
  brand: Brand;
  message: string;
  context?: string;
}): Promise<SmartPlan | null> {
  if (!getServerEnv().KIP_SMART_PLANNER) return null;

  const memory = kipMemoryPromptBlock(input.brand.facts);
  const system = [
    ...personaLines(input.brand),
    memory,
    "You are Kip's silent planner. Output ONLY JSON (no markdown fences):",
    '{"goal":"<one line>","steps":[{"action":"<verb>","detail":"<optional>"}],"kickoffKind":"first_batch"|"draft_posts"|"trend_draft"|"competitor_draft"|null,"speakHint":"<short SMS ack>","confidence":0-1}',
    "Max 4 steps. Prefer a kickoffKind from the allowed list when the owner wants drafts/content work.",
    "Never publish. Never invent ad spend. Never schedule publish. Drafts always need owner approval.",
    "If the ask is a simple single kickoff, still return a tight plan with high confidence.",
    "If you cannot help or the ask is off-topic, return confidence below 0.45.",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    input.context ? `Conversation context:\n${input.context}` : "",
    `Owner message:\n${input.message}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const raw = await callLLM({
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 500,
      temperature: 0.3,
      tier: "smart",
      task: "smart_plan",
    });
    return parseSmartPlan(raw);
  } catch {
    return null;
  }
}
