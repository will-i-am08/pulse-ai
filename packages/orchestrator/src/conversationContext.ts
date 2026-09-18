import { query, queryOne, type Brand, type Message } from "@pulse/shared";
import { callLLM } from "./llm.js";
import { openLoopsPromptBlock, readOpenLoops } from "./speak/openLoops.js";

const DEFAULT_LIMIT = 15;
// If more history exists than this, summarise the overflow in one LLM call
// instead of ever growing the context window unbounded.
const SUMMARISE_THRESHOLD = 30;

/** One SMS turn for the general-agent chat history (not a system-pack blob). */
export type ChatTurn = { role: "user" | "assistant"; content: string };

const AGENT_HISTORY_MESSAGES = 12;

function formatMessage(m: Message): string {
  const who = m.direction === "inbound" ? "Client" : "Kip";
  const media = m.media_ids?.length ? ` [${m.media_ids.length} media attached]` : "";
  return `${who}: ${m.body ?? "(no text)"}${media}`;
}

export function normalizeChatTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const content = t.content.replace(/\s+/g, " ").trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) {
      last.content = `${last.content}\n${content}`;
    } else {
      out.push({ role: t.role, content });
    }
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

/**
 * Last ~6 SMS turns as user/assistant messages. Excludes `excludeMessageId`
 * (the current inbound) so the caller can append it as the final user turn.
 * No summarize LLM.
 */
export async function loadRecentChatTurns(
  brandId: string,
  opts?: { excludeMessageId?: string | null; limit?: number },
): Promise<ChatTurn[]> {
  const limit = Math.max(1, Math.min(24, opts?.limit ?? AGENT_HISTORY_MESSAGES));
  const rows = await query<Pick<Message, "id" | "direction" | "body">>(
    `select id, direction, body
       from messages
      where brand_id = $1
      order by created_at desc, id desc
      limit $2`,
    [brandId, limit + (opts?.excludeMessageId ? 1 : 0)],
  );
  const exclude = opts?.excludeMessageId ?? "";
  const chronological = rows
    .filter((m) => m.id !== exclude && (m.body ?? "").trim())
    .reverse();
  return normalizeChatTurns(
    chronological.map((m) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: (m.body ?? "").trim(),
    })),
  );
}

async function openLoopsBlock(brandId: string): Promise<string> {
  try {
    const brand = await queryOne<Pick<Brand, "facts">>(`select facts from brands where id = $1`, [brandId]);
    if (!brand) return "";
    return openLoopsPromptBlock(readOpenLoops(brand));
  } catch {
    return "";
  }
}

export type BuildConversationContextOpts = {
  limit?: number;
  /**
   * When false, return recent messages + open loops only — skip the count query
   * and the older-thread summarize LLM (that call is ~5s on long threads).
   */
  summarize?: boolean;
};

export function resolveConversationContextArgs(
  limitOrOpts: number | BuildConversationContextOpts | undefined = DEFAULT_LIMIT,
): { limit: number; summarize: boolean } {
  if (typeof limitOrOpts === "number" || limitOrOpts === undefined) {
    return { limit: limitOrOpts ?? DEFAULT_LIMIT, summarize: true };
  }
  return {
    limit: limitOrOpts.limit ?? DEFAULT_LIMIT,
    summarize: limitOrOpts.summarize !== false,
  };
}

export async function buildConversationContext(
  brandId: string,
  limitOrOpts: number | BuildConversationContextOpts = DEFAULT_LIMIT,
): Promise<string> {
  const { limit, summarize } = resolveConversationContextArgs(limitOrOpts);
  const recentRows = await query<Message>(
    `select * from messages where brand_id = $1 order by created_at desc limit $2`,
    [brandId, limit],
  );
  const recent = recentRows.reverse();
  const recentText = recent.map(formatMessage).join("\n") || "(no conversation history yet)";
  const loops = await openLoopsBlock(brandId);
  const loopsPrefix = loops ? `${loops}\n\n` : "";

  if (!summarize) {
    return `${loopsPrefix}${recentText}`;
  }

  const countRow = await queryOne<{ count: string }>(
    `select count(*) as count from messages where brand_id = $1`,
    [brandId],
  );

  const total = countRow ? Number(countRow.count) : recent.length;

  const olderCount = total - recent.length;
  if (olderCount <= 0 || total <= SUMMARISE_THRESHOLD) {
    return `${loopsPrefix}${recentText}`;
  }

  const older = await query<Message>(
    `select * from messages where brand_id = $1 order by created_at asc limit $2`,
    [brandId, olderCount],
  );

  let summary = `(${older.length} earlier messages)`;
  if (older.length > 0) {
    try {
      summary = await callLLM({
        system:
          "Summarise this SMS conversation history between a business owner and their social media manager in " +
          "3-5 bullet points, focused on recurring brand-voice preferences, feedback, and outstanding items.",
        messages: [{ role: "user", content: older.map(formatMessage).join("\n") }],
        maxTokens: 300,
        tier: "fast",
        task: "summarize",
      });
    } catch {
      summary = `(${older.length} earlier messages — summary unavailable)`;
    }
  }

  return `${loopsPrefix}--- Earlier conversation summary ---\n${summary.trim()}\n\n--- Recent messages ---\n${recentText}`;
}

/** Matches onboarding WRAP_ACK so we can detect inbound during voice compile. */
export const WRAP_ACK_PREFIX = "Love it — I've got what I need";

/**
 * True when the owner already texted after the wrap-ack SMS (including during
 * the slow voice compile, which finishes after WRAP_ACK and sets completed_at
 * too late for a completed_at check).
 */
export async function ownerMovedOnSinceWrapAck(
  brandId: string,
  opts?: { withinMinutes?: number },
): Promise<boolean> {
  const kickoff = await queryOne<{ id: string }>(
    `select id from kip_kickoffs
      where brand_id = $1 and status in ('queued', 'running')
      limit 1`,
    [brandId],
  );
  if (kickoff) return true;

  const wrap = await queryOne<{ created_at: string }>(
    `select created_at from messages
      where brand_id = $1 and direction = 'outbound'
        and (
          body ilike 'Love it%got what I need%'
          or body ilike 'Here''s how I''m reading your voice%'
        )
      order by created_at asc
      limit 1`,
    [brandId],
  );
  if (!wrap?.created_at) return false;
  return ownerInboundAfter(brandId, wrap.created_at, {
    withinMinutes: opts?.withinMinutes ?? 15,
  });
}

/**
 * True when the owner texted after `since`. Optional `withinMinutes` limits
 * the lookback so a later idle conversation can still get the parked plan.
 */
export async function ownerInboundAfter(
  brandId: string,
  since: Date | string,
  opts?: { withinMinutes?: number },
): Promise<boolean> {
  const iso = typeof since === "string" ? since : since.toISOString();
  const windowMin = opts?.withinMinutes;
  const row =
    typeof windowMin === "number" && Number.isFinite(windowMin)
      ? await queryOne<{ id: string }>(
          `select id from messages
            where brand_id = $1 and direction = 'inbound' and created_at > $2
              and created_at > now() - make_interval(mins => $3)
            limit 1`,
          [brandId, iso, Math.max(1, Math.floor(windowMin))],
        )
      : await queryOne<{ id: string }>(
          `select id from messages
            where brand_id = $1 and direction = 'inbound' and created_at > $2
            limit 1`,
          [brandId, iso],
        );
  return Boolean(row);
}
