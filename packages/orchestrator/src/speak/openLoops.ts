/**
 * MIRROR-lite open-loop memory — structured waiting_on / promised / prefs / energy
 * stored on brand.facts so the next SMS feels continuous, not amnesiac.
 */

import type { Brand, BusinessFacts } from "@pulse/shared";
import { query } from "@pulse/shared";
import { callLLM } from "../llm.js";

export interface OpenLoops {
  waiting_on: string[];
  promised: string[];
  prefs: string[];
  energy: string;
  updated_at?: string;
}

export const EMPTY_OPEN_LOOPS: OpenLoops = {
  waiting_on: [],
  promised: [],
  prefs: [],
  energy: "steady",
};

export function readOpenLoops(brand: Brand | { facts?: BusinessFacts | null }): OpenLoops {
  const raw = (brand.facts as (BusinessFacts & { open_loops?: Partial<OpenLoops> }) | null | undefined)
    ?.open_loops;
  if (!raw || typeof raw !== "object") return { ...EMPTY_OPEN_LOOPS };
  return {
    waiting_on: cleanScratchList(raw.waiting_on),
    promised: arr(raw.promised),
    prefs: cleanScratchList(raw.prefs),
    energy: typeof raw.energy === "string" && raw.energy.trim() ? raw.energy.trim() : "steady",
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : undefined,
  };
}

function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
}

/**
 * Prefs / waiting_on that teach Kip to interview instead of acting, or to hard-ban
 * owner topic asks. Drop them from the scratchpad so they cannot poison the next turn.
 */
export function isInterviewLoopScratch(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return (
    /\bdiscovery questions?\b/i.test(t) ||
    /\binterview\b.{0,40}\b(before|first)\b/i.test(t) ||
    /\b(ask|questions?).{0,40}\b(before|prior to).{0,40}\b(suggest|idea|direction|draft)/i.test(t) ||
    /\bbefore suggesting\b/i.test(t) ||
    /\bstay in .{0,60}lane\b/i.test(t) ||
    /\bowner'?s answer:\s*what (they'?re|are you)\b/i.test(t) ||
    /\bwhat(?:'s| is) (?:bugging|frustrating) (?:them|you|founders)\b/i.test(t) ||
    /\bwhat (?:they'?re|are you) (?:working on|noticing)\b/i.test(t)
  );
}

function cleanScratchList(v: unknown): string[] {
  return arr(v).filter((x) => !isInterviewLoopScratch(x)).slice(0, 5);
}

/** Short block for conversation context / Speak system. */
export function openLoopsPromptBlock(loops: OpenLoops): string {
  const has =
    loops.waiting_on.length || loops.promised.length || loops.prefs.length || loops.energy !== "steady";
  if (!has) return "";
  const lines = ["On your mind (act on these naturally — don't dump as a list):"];
  if (loops.waiting_on.length) lines.push(`Waiting on owner: ${loops.waiting_on.join("; ")}`);
  if (loops.promised.length) lines.push(`You promised: ${loops.promised.join("; ")}`);
  if (loops.prefs.length) lines.push(`Prefs: ${loops.prefs.join("; ")}`);
  if (loops.energy) lines.push(`Energy: ${loops.energy}`);
  return lines.join("\n");
}

/**
 * After an outbound SMS, compress the turn into open_loops on brand.facts.
 * Fire-and-forget — never block the reply path.
 */
export async function updateOpenLoopsAfterTurn(
  brand: Brand,
  ownerMessage: string | null | undefined,
  kipReply: string | null | undefined,
): Promise<OpenLoops | null> {
  const prev = readOpenLoops(brand);
  const owner = (ownerMessage ?? "").trim();
  const kip = (kipReply ?? "").trim();
  if (!owner && !kip) return null;

  try {
    const raw = await callLLM({
      system: [
        "Update Kip's private scratchpad for the next SMS turn. Output ONLY JSON:",
        '{"waiting_on":[],"promised":[],"prefs":[],"energy":"steady|upbeat|careful|rushed"}',
        "waiting_on = concrete missing artifacts only (photo attach, yes/no on a specific draft, connect link). Never invent an intake questionnaire when the owner asked for ideas, suggestions, or research — Kip should deliver those.",
        "promised = what Kip committed to do.",
        "prefs = durable owner taste (tone, formats, topics) learned this turn. Never store process habits like 'ask discovery questions first' or 'interview before suggesting'. Never store a hard topic ban that blocks an ask the owner just made.",
        "Keep each array ≤5 short phrases. Drop resolved items. Merge with prior state thoughtfully.",
      ].join("\n"),
      messages: [
        {
          role: "user",
          content: [
            `Prior scratchpad: ${JSON.stringify(prev)}`,
            owner ? `Owner just said: ${owner}` : "Owner: (none)",
            kip ? `Kip just replied: ${kip}` : "Kip: (none)",
          ].join("\n"),
        },
      ],
      maxTokens: 280,
      temperature: 0.2,
      tier: "fast",
      task: "open_loops",
    });
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<OpenLoops>;
    const nextPrefs = cleanScratchList(parsed.prefs);
    const next: OpenLoops = {
      waiting_on: cleanScratchList(parsed.waiting_on),
      promised: arr(parsed.promised).slice(0, 5),
      prefs: nextPrefs.length ? nextPrefs : cleanScratchList(prev.prefs),
      energy: typeof parsed.energy === "string" && parsed.energy.trim() ? parsed.energy.trim() : prev.energy,
      updated_at: new Date().toISOString(),
    };

    const facts: BusinessFacts = { ...(brand.facts ?? {}), open_loops: next };
    await query(`update brands set facts = $1::jsonb, updated_at = now() where id = $2`, [
      JSON.stringify(facts),
      brand.id,
    ]);
    brand.facts = facts;
    return next;
  } catch (err) {
    console.error(`updateOpenLoopsAfterTurn: brand ${brand.id}`, err);
    return null;
  }
}

/** Non-blocking wrapper for reply paths. */
export function scheduleOpenLoopsUpdate(
  brand: Brand,
  ownerMessage: string | null | undefined,
  kipReply: string | null | undefined,
): void {
  void updateOpenLoopsAfterTurn(brand, ownerMessage, kipReply).catch(() => {
    /* already logged */
  });
}
