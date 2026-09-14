import { query } from "@pulse/shared";

const DEFAULT_LIMIT = 10;

/** Last N outbound SMS bodies Kip sent this brand (newest first). */
export async function loadRecentOutbound(brandId: string, limit = DEFAULT_LIMIT): Promise<string[]> {
  try {
    const rows = await query<{ body: string | null }>(
      `select body from messages
        where brand_id = $1 and direction = 'outbound' and body is not null and length(trim(body)) > 0
        order by created_at desc
        limit $2`,
      [brandId, limit],
    );
    return rows.map((r) => (r.body ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Negative examples so Kip does not echo recent phrasing/structure. */
export function recentOutsPromptBlock(recent: string[]): string {
  if (!recent.length) return "";
  const lines = recent.slice(0, DEFAULT_LIMIT).map((b, i) => `${i + 1}. ${b.slice(0, 220)}`);
  return [
    "You already sent these recently — do NOT reuse their wording, openers, or sentence shape. Say it differently:",
    ...lines,
  ].join("\n");
}
