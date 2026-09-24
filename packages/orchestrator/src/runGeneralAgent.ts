/**
 * Owner-SMS / clock brain: retrieve brand context, identity system prompt,
 * bounded tool loop, SMS humanize, then a kickoff safety net if the model
 * promised work without a successful draft_copy.
 *
 * Default inbound path after hard gates. Does not rewrite the content engine.
 * Owns create + revise of drafts via tools (including pending drafts and photos).
 * High-confidence approval ("yes") on an offered draft never enters this loop.
 */

import type { Brand } from "@pulse/shared";
import type Anthropic from "@anthropic-ai/sdk";
import { KIP_AGENT_TOOLS, executeAgentTool } from "./agentTools.js";
import { agentIdentity } from "./agentIdentity.js";
import { looksLikeApproval } from "./classify.js";
import { loadRecentChatTurns } from "./conversationContext.js";
import { maybeEnqueueFromKipCommit } from "./kickoffs.js";
import { durablePrefFromCorrectionNote, recordKipMemory } from "./kipMemory.js";
import { callLLMWithTools, stripMarkdown } from "./llm.js";
import { retrieveBrandContext } from "./retrieveContext.js";
import { humanizeChat } from "./speak/humanizeChat.js";
import { scheduleOpenLoopsUpdate } from "./speak/openLoops.js";

export type RunGeneralAgentOpts = {
  brand: Brand;
  ownerMessage: string;
  sourceMessageId?: string | null;
  mediaIds?: string[];
};

export type RunGeneralAgentResult = {
  reply: string;
  operatorAlert?: string;
  mediaUrl?: string;
};

/** In-character SMS when the tool loop throws. Never names an operator or agency. */
export function generalAgentFallbackSms(ownerMessage: string | null | undefined): string {
  const t = (ownerMessage ?? "").trim();
  // Only ask them to resend when they were clearly trying to deliver media / a failed attach.
  if (
    t &&
    /\b(photo|pic|picture|image|video|clip|mms|send(ing)? (it|this|that) again|resent|re-?send)\b/i.test(t) &&
    !/\b(draft|carousel|suggest|idea|research|look into|post about)\b/i.test(t)
  ) {
    return "That one glitched on my side. Mind sending it again?";
  }
  return "Hit a snag on my side — say go and I'll retry.";
}

/**
 * True when leftover / inbound turns may enter the agent.
 * Pending drafts are allowed — the agent mutates them via tools.
 * Photos are briefs (hasMedia does not lock the agent out).
 * High-confidence approval ("yes") on an offered draft stays on the hard-gate
 * router — never this loop.
 *
 * `flag` is ignored (agent is the inbound path). Kept optional so older call
 * sites / lab harnesses still typecheck.
 */
export function generalAgentEligible(opts: {
  flag?: boolean;
  hasMedia?: boolean;
  hasPending: boolean;
  ownerMessage?: string;
}): boolean {
  void opts.flag;
  void opts.hasMedia;
  const t = (opts.ownerMessage ?? "").trim();
  if (opts.hasPending && looksLikeApproval(t)) return false;
  return true;
}

function ownerUserContent(ownerMessage: string, mediaIds?: string[]): string {
  const ids = (mediaIds ?? []).filter(Boolean);
  if (ids.length === 0) return ownerMessage;
  return `${ownerMessage}\n\nAttached media ids: ${ids.join(", ")}`;
}

function appendCurrentUser(
  history: Anthropic.MessageParam[],
  current: string,
): Anthropic.MessageParam[] {
  const last = history[history.length - 1];
  if (last && last.role === "user" && typeof last.content === "string") {
    return [...history.slice(0, -1), { role: "user", content: `${last.content}\n${current}` }];
  }
  return [...history, { role: "user", content: current }];
}

export async function runGeneralAgent(
  opts: RunGeneralAgentOpts,
): Promise<RunGeneralAgentResult> {
  const { brand, ownerMessage, sourceMessageId, mediaIds } = opts;
  const [pack, history] = await Promise.all([
    retrieveBrandContext(brand, ownerMessage),
    loadRecentChatTurns(brand.id, { excludeMessageId: sourceMessageId }).catch(() => []),
  ]);
  const system = agentIdentity(brand, pack.text);
  const operatorAlerts: string[] = [];
  const lastMediaUrl: { url?: string | null } = {};
  let remembered = false;

  const historyMessages: Anthropic.MessageParam[] = history.map((t) => ({
    role: t.role,
    content: t.content,
  }));
  const messages = appendCurrentUser(
    historyMessages,
    ownerUserContent(ownerMessage, mediaIds),
  );

  let reply: string | undefined;
  let draftedViaTool = false;
  try {
    const raw = await callLLMWithTools({
      system,
      messages,
      maxTokens: 700,
      temperature: 0.7,
      tier: "smart",
      task: "general_agent",
      tools: KIP_AGENT_TOOLS,
      maxRounds: 4,
      toolExecutor: async (name, input) => {
        if (name === "remember_fact") remembered = true;
        if (name === "draft_copy") draftedViaTool = true;
        return executeAgentTool(name, input, {
          brand,
          sourceMessageId,
          ownerMessage,
          mediaIds,
          retrievedPack: pack.text,
          operatorAlerts,
          lastMediaUrl,
        });
      },
    });
    reply = humanizeChat(stripMarkdown(raw));
  } catch (err) {
    console.error(`runGeneralAgent: brand ${brand.id}`, err);
    reply = humanizeChat(stripMarkdown(generalAgentFallbackSms(ownerMessage)));
  }

  if (reply) {
    // draft_copy already enqueued the job — kip_commit must not queue a second
    // first_batch/draft_posts just because the owner said "generated photo".
    // Clock wakes are not owner briefs; never enqueue from our own nudge copy.
    if (!draftedViaTool && !ownerMessage.startsWith("[Clock wake")) {
      await maybeEnqueueFromKipCommit(brand, ownerMessage, reply, sourceMessageId);
    }
    scheduleOpenLoopsUpdate(brand, ownerMessage, reply);
  }

  const durable = durablePrefFromCorrectionNote(ownerMessage);
  if (durable && !remembered) {
    await recordKipMemory(brand, durable, "kip_preferences").catch(() => {});
  }

  return {
    reply,
    operatorAlert: operatorAlerts[0],
    mediaUrl: lastMediaUrl.url || undefined,
  };
}
