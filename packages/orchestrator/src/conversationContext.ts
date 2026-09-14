import { query, queryOne, type Brand, type Message } from "@pulse/shared";
import { callLLM } from "./llm.js";
import { openLoopsPromptBlock, readOpenLoops } from "./speak/openLoops.js";

const DEFAULT_LIMIT = 15;
// If more history exists than this, summarise the overflow in one LLM call
// instead of ever growing the context window unbounded.
const SUMMARISE_THRESHOLD = 30;

function formatMessage(m: Message): string {
  const who = m.direction === "inbound" ? "Client" : "Kip";
  const media = m.media_ids?.length ? ` [${m.media_ids.length} media attached]` : "";
  return `${who}: ${m.body ?? "(no text)"}${media}`;
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

export async function buildConversationContext(brandId: string, limit = DEFAULT_LIMIT): Promise<string> {
  const recentRows = await query<Message>(
    `select * from messages where brand_id = $1 order by created_at desc limit $2`,
    [brandId, limit],
  );
  const recent = recentRows.reverse();

  const countRow = await queryOne<{ count: string }>(
    `select count(*) as count from messages where brand_id = $1`,
    [brandId],
  );

  const total = countRow ? Number(countRow.count) : recent.length;
  const recentText = recent.map(formatMessage).join("\n") || "(no conversation history yet)";
  const loops = await openLoopsBlock(brandId);
  const loopsPrefix = loops ? `${loops}\n\n` : "";

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
      });
    } catch {
      summary = `(${older.length} earlier messages — summary unavailable)`;
    }
  }

  return `${loopsPrefix}--- Earlier conversation summary ---\n${summary.trim()}\n\n--- Recent messages ---\n${recentText}`;
}
