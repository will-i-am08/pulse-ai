import { getServerEnv, query } from "@pulse/shared";
import { logger } from "../lib/logger.js";

/**
 * Optional weekly purge of design_memory + research_snapshots older than
 * RETENTION_DAYS (default 180). Keeps cold storage lean without touching
 * live brand objects, posts, or visual_exemplars.
 *
 * Documented in docs/LIVE_CHECKLIST.md. Safe to no-op if tables missing.
 */
export async function runRetentionPurgeLoop(): Promise<void> {
  let days = 180;
  try {
    days = getServerEnv().RETENTION_DAYS;
  } catch {
    const n = Number(process.env.RETENTION_DAYS ?? 180);
    if (Number.isFinite(n) && n >= 30) days = n;
  }

  try {
    const mem = await query<{ n: string }>(
      `with deleted as (
         delete from design_memory where created_at < now() - ($1 || ' days')::interval
         returning 1
       ) select count(*)::text as n from deleted`,
      [String(days)],
    );
    const snaps = await query<{ n: string }>(
      `with deleted as (
         delete from research_snapshots where created_at < now() - ($1 || ' days')::interval
         returning 1
       ) select count(*)::text as n from deleted`,
      [String(days)],
    );
    const memN = Number(mem[0]?.n ?? 0);
    const snapN = Number(snaps[0]?.n ?? 0);
    if (memN > 0 || snapN > 0) {
      logger.info(`retention purge: removed ${memN} design_memory + ${snapN} research_snapshots (>${days}d)`);
    }
  } catch (err) {
    logger.error("retention purge failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
