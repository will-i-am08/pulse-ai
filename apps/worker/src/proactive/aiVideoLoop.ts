import { sendToBrand, runAiVideoJobDrain } from "./deps.js";
import { logger } from "../lib/logger.js";

/**
 * Drain queued AI video jobs and SMS the brand when each is ready (or failed).
 * Phase G4 async "I'll text when ready" pattern.
 */
export async function runAiVideoLoop(): Promise<void> {
  try {
    const results = await runAiVideoJobDrain(2);
    for (const r of results) {
      try {
        await sendToBrand(r.brandId, r.sms, r.mediaUrl ? [r.mediaUrl] : undefined);
      } catch (err) {
        logger.error(`ai-video: failed to SMS brand ${r.brandId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    logger.error("ai-video drain failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
