import { sendToOperator } from "@pulse/gateway";
import { sendToBrand, runKickoffDrain, reclaimStaleKickoffs } from "./deps.js";
import { logger } from "../lib/logger.js";

/**
 * Drain Kip's self-kickoff queue and SMS each draft as it finishes (parallel
 * generation inside the drain). Covers user-asked work, Kip verbal commits,
 * and proactive autonomy jobs.
 */
export async function runKickoffLoop(): Promise<void> {
  try {
    await runKickoffDrain(2, {
      deliver: async (r) => {
        logger.info(`kickoff: deliver to brand ${r.brandId}`);
        await sendToBrand(r.brandId, r.sms, r.mediaUrls?.length ? r.mediaUrls : r.mediaUrl ? [r.mediaUrl] : undefined);
        // Repeated zero-draft runs for one brand are an operator problem (dead
        // image provider), not something the client can fix by retrying.
        if (r.operatorAlert) {
          await sendToOperator(r.operatorAlert).catch((err) =>
            logger.error("kickoff: operator alert failed", {
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      },
    });
  } catch (err) {
    logger.error("kickoff drain failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Reap abandoned `running` kickoffs on an interval of its own.
 *
 * runKickoffDrain also reclaims, but only as its first step — so a drain loop
 * wedged on a hung LLM socket meant no reaping either, and the partial unique
 * index on (brand_id, kind) locked the brand out of ever asking again. The
 * reclaim UPDATE is an atomic status swap, so running it from both places is
 * safe: only one caller can win a given row.
 */
export async function runKickoffReaperLoop(): Promise<void> {
  try {
    const reclaimed = await reclaimStaleKickoffs({
      deliver: async (r) => {
        await sendToBrand(r.brandId, r.sms, r.mediaUrl ? [r.mediaUrl] : undefined);
      },
    });
    if (reclaimed.length) {
      logger.warn(`kickoff reaper: reclaimed ${reclaimed.length} stale running kickoff(s)`);
    }
  } catch (err) {
    logger.error("kickoff reaper failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
