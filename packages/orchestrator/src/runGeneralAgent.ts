/**
 * Wave 2 general-agent turn: retrieve brand context, identity system prompt,
 * bounded tool loop, SMS humanize, then a kickoff safety net if the model
 * promised work without a successful draft_copy.
 *
 * Gated by KIP_GENERAL_AGENT (off by default). Does not rewrite the content engine.
 */

import type { Brand } from "@pulse/shared";
import type Anthropic from "@anthropic-ai/sdk";
import { KIP_AGENT_TOOLS, executeAgentTool } from "./agentTools.js";
import { agentIdentity } from "./agentIdentity.js";
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
};

/** In-character SMS when the tool loop throws. Never names an operator or agency. */
const GENERAL_AGENT_FALLBACK_SMS =
  "That one glitched on my side. Mind sending it again?";

/**
 * True when the general-agent intercept may run: flag on, no attached media,
 * no pending_approval draft. Pure helper so tests can cover eligibility
 * without booting the full inbound router.
 */
export function generalAgentEligible(opts: {
  flag: boolean;
  hasMedia: boolean;
  hasPending: boolean;
}): boolean {
  return opts.flag && !opts.hasMedia && !opts.hasPending;
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
        return executeAgentTool(name, input, {
          brand,
          sourceMessageId,
          mediaIds,
          retrievedPack: pack.text,
          operatorAlerts,
        });
      },
    });
    reply = humanizeChat(stripMarkdown(raw));
  } catch {
    reply = humanizeChat(stripMarkdown(GENERAL_AGENT_FALLBACK_SMS));
  }

  if (reply) {
    await maybeEnqueueFromKipCommit(brand, ownerMessage, reply, sourceMessageId);
    scheduleOpenLoopsUpdate(brand, ownerMessage, reply);
  }

  const durable = durablePrefFromCorrectionNote(ownerMessage);
  if (durable && !remembered) {
    await recordKipMemory(brand, durable, "kip_preferences").catch(() => {});
  }

  return { reply, operatorAlert: operatorAlerts[0] };
}
