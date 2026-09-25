import { query, queryOne, type Brand } from "@pulse/shared";
import { sendToBrand, isDaytime, composeClockSms } from "./deps.js";
import { logger } from "../lib/logger.js";

/**
 * Nudge once about a draft left waiting ~24h (daytime only). Atomic chased_at
 * claim prevents double-send on overlapping ticks / restarts.
 * SMS comes from the same brain — never a yes/tweak/no menu.
 */
export async function runChaseLoop(): Promise<void> {
  if (!isDaytime(new Date())) return;

  const rows = await query<{ id: string; brand_id: string; pillar_name: string | null }>(
    `select p.id, p.brand_id, pl.name as pillar_name
       from posts p
       join brands b on b.id = p.brand_id and b.status = 'active'
       left join pillars pl on pl.id = p.pillar_id
      where p.status = 'pending_approval'
        and p.chased_at is null
        and p.created_at <= now() - interval '24 hours'
        and p.created_at >= now() - interval '7 days'
      order by p.created_at asc
      limit 20`,
  );

  for (const row of rows) {
    const claimed = await query<{ id: string }>(
      "update posts set chased_at = now() where id = $1 and chased_at is null returning id",
      [row.id],
    );
    if (claimed.length === 0) continue;
    const what = row.pillar_name ? `your ${row.pillar_name} post` : "the post I drafted";
    try {
      const brand = await queryOne<Brand>(`select * from brands where id = $1`, [row.brand_id]);
      if (!brand) continue;
      const body = await composeClockSms(
        brand,
        `Chase: ${what} has been sitting pending_approval ~24h. Nudge once like a colleague. Do not dump yes/change/no. Do not approve or publish.`,
      );
      await sendToBrand(row.brand_id, body);
    } catch (err) {
      logger.error(`chase: send failed for post ${row.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
