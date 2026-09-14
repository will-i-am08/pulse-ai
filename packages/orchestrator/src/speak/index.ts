/**
 * Speak pipeline — variety layer + optional Think + similarity gate + humanize.
 * One chokepoint for owner-facing Kip SMS so replies feel human, not templated.
 */

import type { Brand } from "@pulse/shared";
import { callLLM } from "../llm.js";
import { personaLines } from "../persona.js";
import { styleBankPromptBlock } from "./styleBank.js";
import { loadRecentOutbound, recentOutsPromptBlock } from "./recentOuts.js";
import { structuralConstraintPromptBlock } from "./constraints.js";
import { tooSimilarToRecent } from "./similarity.js";
import { humanizeChat } from "./humanizeChat.js";
import {
  needsThink,
  runThink,
  thinkPromptBlock,
  type SpeakMode,
  type ThinkResult,
} from "./think.js";
import { openLoopsPromptBlock, readOpenLoops, scheduleOpenLoopsUpdate } from "./openLoops.js";

export type { SpeakMode, ThinkResult };
export { needsThink, humanizeChat, readOpenLoops, scheduleOpenLoopsUpdate };
export { jaccardSimilarity, tooSimilarToRecent, SIMILARITY_THRESHOLD } from "./similarity.js";
export { sampleStyleBank, styleBankPromptBlock, STYLE_BANK } from "./styleBank.js";
export { STRUCTURAL_CONSTRAINTS, pickStructuralConstraint } from "./constraints.js";

export interface SpeakOptions {
  brand: Brand;
  mode: SpeakMode;
  /** Mode-specific instructions (after persona + variety layers). */
  modeLines: string[];
  userContent: string;
  maxTokens?: number;
  webSearch?: boolean | number;
  temperature?: number;
  /** Force / skip Think. Default: needsThink() heuristics. */
  think?: boolean;
  /** Owner message used for Think + open-loop updates. */
  ownerMessage?: string | null;
  classification?: string | null;
  confidence?: number | null;
  /** Conversation context string (also fed to Think). */
  context?: string | null;
  /** When false, skip async open-loop update (default true). */
  updateOpenLoops?: boolean;
  /** Inject a fixed constraint (tests). */
  constraintSeed?: number;
}

export interface BuildSpeakSystemOptions {
  brand: Brand;
  mode: SpeakMode;
  modeLines: string[];
  recentOutbound?: string[];
  think?: ThinkResult | null;
  constraintSeed?: number;
}

/** Assemble the Speak system prompt (persona + variety + optional Think). */
export function buildSpeakSystem(opts: BuildSpeakSystemOptions): string {
  const loops = openLoopsPromptBlock(readOpenLoops(opts.brand));
  const parts = [
    ...personaLines(opts.brand),
    styleBankPromptBlock(opts.mode),
    recentOutsPromptBlock(opts.recentOutbound ?? []),
    structuralConstraintPromptBlock(opts.constraintSeed),
    loops,
    opts.think ? thinkPromptBlock(opts.think) : "",
    ...opts.modeLines,
    "Plain SMS only. No em dashes, no markdown, no bullet lists, no feature menus.",
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * Generate an owner-facing SMS: Speak (+ optional Think), humanize, similarity
 * regenerate once if too close to a recent outbound.
 */
export async function speakSMS(opts: SpeakOptions): Promise<string> {
  const recent = await loadRecentOutbound(opts.brand.id, 10);
  const shouldThink =
    opts.think === true ||
    (opts.think !== false &&
      needsThink({
        mode: opts.mode,
        message: opts.ownerMessage ?? opts.userContent,
        classification: opts.classification,
        confidence: opts.confidence,
      }));

  let think: ThinkResult | null = null;
  if (shouldThink) {
    think = await runThink(
      opts.brand,
      opts.ownerMessage ?? opts.userContent,
      opts.mode,
      opts.context ?? undefined,
    );
  }

  const system = buildSpeakSystem({
    brand: opts.brand,
    mode: opts.mode,
    modeLines: opts.modeLines,
    recentOutbound: recent,
    think,
    constraintSeed: opts.constraintSeed,
  });

  const gen = async (extra?: string) => {
    const systemFull = extra ? `${system}\n${extra}` : system;
    const text = await callLLM({
      system: systemFull,
      messages: [{ role: "user", content: opts.userContent }],
      maxTokens: opts.maxTokens ?? 500,
      temperature: opts.temperature ?? 0.9,
      webSearch: opts.webSearch,
    });
    return humanizeChat(text);
  };

  let out = await gen();
  if (tooSimilarToRecent(out, recent)) {
    out = await gen(
      "Your previous draft was too similar to a recent text you sent. Rewrite with a different opener and sentence shape. Same meaning, fresh words.",
    );
  }

  if (opts.updateOpenLoops !== false) {
    scheduleOpenLoopsUpdate(opts.brand, opts.ownerMessage ?? null, out);
  }

  return out;
}
