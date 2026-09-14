import { sendToBrand, runKickoffDrain } from "./deps.js";
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
      },
    });
  } catch (err) {
    logger.error("kickoff drain failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
