import { isDaytime, runAutonomyPass } from "./deps.js";
import { logger } from "../lib/logger.js";

/**
 * Proactive autonomy tick — scout trends and queue Kip self-kickoffs.
 * Competitor-response drafts are hooked from the competitor-watch loop.
 */
export async function runAutonomyLoop(): Promise<void> {
  if (!isDaytime(new Date())) return;
  try {
    const { trends } = await runAutonomyPass();
    if (trends > 0) {
      logger.info(`autonomy: queued ${trends} trend draft kickoff(s)`);
    }
  } catch (err) {
    logger.error("autonomy pass failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
