import { query } from "@pulse/shared";
import { sendToBrand, isDaytime } from "./deps.js";
import { logger } from "../lib/logger.js";

/** Pick a varied chase nudge for a pending draft. */
function chaseNudge(what: string): string {
  const templates = [
    `Quick nudge — ${what} is still waiting. Want it to go out, or shall I tweak it? ("no" to bin it.)`,
    `Hey, ${what} has been sitting there. Ship it, tweak it, or scrap it?`,
    `${what} is still pending. "Yes" to post, tell me a change, or "no" to discard.`,
    `Just checking — ${what} ready to go, or want changes?`,
    `Still on ${what}? Reply yes to send it, tell me a change, or no to scrap it.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

/**
 * Nudge once about a draft left waiting ~24h (daytime only). Atomic chased_at
 * claim prevents double-send on overlapping ticks / restarts.
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
      await sendToBrand(row.brand_id, chaseNudge(what));
    } catch (err) {
      logger.error(`chase: send failed for post ${row.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
