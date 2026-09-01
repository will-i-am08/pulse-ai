import { serviceClient } from "@pulse/shared";
import type { Message } from "@pulse/shared";
import { callLLM } from "./llm.js";

const DEFAULT_LIMIT = 15;
// If more history exists than this, summarise the overflow in one LLM call
// instead of ever growing the context window unbounded.
const SUMMARISE_THRESHOLD = 30;

function formatMessage(m: Message): string {
  const who = m.direction === "inbound" ? "Client" : "Pulse";
  const media = m.media_ids?.length ? ` [${m.media_ids.length} media attached]` : "";
  return `${who}: ${m.body ?? "(no text)"}${media}`;
}

export async function buildConversationContext(brandId: string, limit = DEFAULT_LIMIT): Promise<string> {
  const db = serviceClient();

  const { data: recentData, error: recentErr } = await db
    .from("messages")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (recentErr) throw recentErr;
  const recent = ((recentData as Message[] | null) ?? []).reverse();

  const { count, error: countErr } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId);
  if (countErr) throw countErr;

  const total = count ?? recent.length;
  const recentText = recent.map(formatMessage).join("\n") || "(no conversation history yet)";

  const olderCount = total - recent.length;
  if (olderCount <= 0 || total <= SUMMARISE_THRESHOLD) {
    return recentText;
  }

  const { data: olderData, error: olderErr } = await db
    .from("messages")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: true })
    .limit(olderCount);
  if (olderErr) throw olderErr;
  const older = (olderData as Message[] | null) ?? [];

  let summary = `(${older.length} earlier messages)`;
  if (older.length > 0) {
    try {
      summary = await callLLM({
        system:
          "Summarise this SMS conversation history between a social media agency and a client in " +
          "3-5 bullet points, focused on recurring brand-voice preferences, feedback, and outstanding items.",
        messages: [{ role: "user", content: older.map(formatMessage).join("\n") }],
        maxTokens: 300,
      });
    } catch {
      summary = `(${older.length} earlier messages — summary unavailable)`;
    }
  }

  return `--- Earlier conversation summary ---\n${summary.trim()}\n\n--- Recent messages ---\n${recentText}`;
}
