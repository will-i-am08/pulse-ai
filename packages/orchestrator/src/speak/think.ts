/**
 * Selective Think-then-Speak — hidden JSON plan on hard turns only.
 * Routine greetings / thanks stay single-pass Speak.
 */

import type { Brand } from "@pulse/shared";
import { callLLM } from "../llm.js";
import { personaLines } from "../persona.js";

export type SpeakMode = "converse" | "reengage" | "answer" | "nudge" | "proactive";

export interface ThinkResult {
  intent: string;
  emotion: string;
  next_step: string;
  avoid: string[];
}

const HARD_CLASSIFICATIONS = new Set(["edit", "instruction"]);

const FRUSTRATION_RE =
  /\b(annoyed|annoying|frustrated|frustrating|wrong|hate|terrible|awful|useless|stupid|angry|pissed|fed up|not what i|that's not|that is not|stop|enough|seriously)\b/i;

const MULTI_ASK_RE = /\?.*\?/;

const STRATEGY_RE =
  /\b(strategy|positioning|competitor|campaign|pillar|icp|audience|funnel|offer|pricing|rebrand|pivot|direction)\b/i;

const CORRECTION_RE =
  /\b(change|instead|don't|dont|never|always|rewrite|fix|shorter|longer|less|more|no emoji|too (salesy|long|short|corporate|try.?hard))\b/i;

export interface NeedsThinkInput {
  mode: SpeakMode;
  message?: string | null;
  /** From classifyInbound when available. */
  classification?: string | null;
  confidence?: number | null;
}

/**
 * Cheap rules: Think only when the turn is ambiguous, emotional, corrective,
 * strategic, or multi-intent. Greetings stay Speak-only.
 */
export function needsThink(input: NeedsThinkInput): boolean {
  const msg = (input.message ?? "").trim();
  if (!msg) return false;

  if (input.mode === "nudge" || input.mode === "proactive") return false;
  if (input.mode === "converse" && msg.length < 40 && !FRUSTRATION_RE.test(msg) && !CORRECTION_RE.test(msg)) {
    return false;
  }

  if (typeof input.confidence === "number" && input.confidence < 0.55) return true;
  if (input.classification && HARD_CLASSIFICATIONS.has(input.classification)) return true;
  if (FRUSTRATION_RE.test(msg)) return true;
  if (STRATEGY_RE.test(msg)) return true;
  if (CORRECTION_RE.test(msg) && msg.length > 24) return true;
  if (MULTI_ASK_RE.test(msg) && msg.length > 50) return true;
  if (input.mode === "answer" && msg.length > 120) return true;
  if (input.mode === "reengage") return true;

  return false;
}

/** Hidden Think JSON — never shown to the owner. */
export async function runThink(
  brand: Brand,
  message: string,
  mode: SpeakMode,
  context?: string,
): Promise<ThinkResult | null> {
  try {
    const raw = await callLLM({
      system: [
        ...personaLines(brand),
        "Think silently before you text the owner. Output ONLY JSON, no prose:",
        '{"intent":"<what they want>","emotion":"<their vibe>","next_step":"<one concrete next move for Kip>","avoid":["<phrase or move to skip>"]}',
        "Be brief. avoid has 0-3 short strings. Never address the owner here.",
        `Speak mode: ${mode}.`,
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: context
            ? `Recent context:\n${context}\n\nTheir message:\n${message}`
            : `Their message:\n${message}`,
        },
      ],
      maxTokens: 220,
      temperature: 0.3,
      tier: "smart",
      task: "think",
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<ThinkResult>;
    return {
      intent: String(parsed.intent ?? "").trim() || "respond",
      emotion: String(parsed.emotion ?? "").trim() || "neutral",
      next_step: String(parsed.next_step ?? "").trim() || "reply helpfully",
      avoid: Array.isArray(parsed.avoid)
        ? parsed.avoid.map((a) => String(a).trim()).filter(Boolean).slice(0, 5)
        : [],
    };
  } catch {
    return null;
  }
}

export function thinkPromptBlock(think: ThinkResult): string {
  const avoid = think.avoid.length ? think.avoid.map((a) => `- ${a}`).join("\n") : "- (none)";
  return [
    "Internal plan (do not mention this plan; just text naturally):",
    `Intent: ${think.intent}`,
    `Their vibe: ${think.emotion}`,
    `Your next step: ${think.next_step}`,
    `Avoid:\n${avoid}`,
  ].join("\n");
}
