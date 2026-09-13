import { sendToBrand, runKickoffDrain } from "./deps.js";
import { logger } from "../lib/logger.js";

/**
 * Drain Kip's self-kickoff queue and SMS each resulting draft / approval ask.
 * Covers user-asked work, Kip verbal commits, and proactive autonomy jobs.
 */
export async function runKickoffLoop(): Promise<void> {
  try {
    const results = await runKickoffDrain(2);
    for (const r of results) {
      try {
        logger.info(`kickoff: deliver to brand ${r.brandId}`);
        await sendToBrand(r.brandId, r.sms, r.mediaUrl ? [r.mediaUrl] : undefined);
      } catch (err) {
        logger.error(`kickoff: failed to SMS brand ${r.brandId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error("kickoff drain failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
