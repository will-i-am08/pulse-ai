/**
 * Wave 2 general-agent turn: retrieve brand context, identity system prompt,
 * bounded tool loop, SMS humanize, then a kickoff safety net if the model
 * promised work without a successful draft_copy.
 *
 * Gated by KIP_GENERAL_AGENT (off by default). Does not rewrite the content engine.
 */

import type { Brand } from "@pulse/shared";
import { KIP_AGENT_TOOLS, executeAgentTool } from "./agentTools.js";
import { agentIdentity } from "./agentIdentity.js";
import { maybeEnqueueFromKipCommit } from "./kickoffs.js";
import { callLLMWithTools, stripMarkdown } from "./llm.js";
import { retrieveBrandContext } from "./retrieveContext.js";
import { humanizeChat } from "./speak/humanizeChat.js";

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

export async function runGeneralAgent(
  opts: RunGeneralAgentOpts,
): Promise<RunGeneralAgentResult> {
  const { brand, ownerMessage, sourceMessageId, mediaIds } = opts;
  const pack = await retrieveBrandContext(brand, ownerMessage);
  const system = agentIdentity(brand, pack.text);
  const operatorAlerts: string[] = [];

  let reply: string | undefined;
  try {
    const raw = await callLLMWithTools({
      system,
      messages: [{ role: "user", content: ownerUserContent(ownerMessage, mediaIds) }],
      maxTokens: 700,
      temperature: 0.7,
      tier: "smart",
      task: "general_agent",
      tools: KIP_AGENT_TOOLS,
      maxRounds: 4,
      toolExecutor: (name, input) =>
        executeAgentTool(name, input, {
          brand,
          sourceMessageId,
          mediaIds,
          retrievedPack: pack.text,
          operatorAlerts,
        }),
    });
    reply = humanizeChat(stripMarkdown(raw));
  } catch {
    reply = humanizeChat(stripMarkdown(GENERAL_AGENT_FALLBACK_SMS));
  }

  if (reply) {
    await maybeEnqueueFromKipCommit(brand, ownerMessage, reply, sourceMessageId);
  }

  return { reply, operatorAlert: operatorAlerts[0] };
}
