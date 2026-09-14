import { sendToBrand, runAiVideoJobDrain } from "./deps.js";
// Imported directly rather than via deps.ts so this fix doesn't touch a shared file.
import { reapStaleAiVideoJobs } from "@pulse/orchestrator";
import { logger } from "../lib/logger.js";

/**
 * Drain queued AI video jobs and SMS the brand when each is ready (or failed).
 * Phase G4 async "I'll text when ready" pattern.
 *
 * Reaps stalled 'running' rows first: a hung provider read otherwise leaves the
 * job running forever — no failure SMS, and the monthly cap headroom never returns.
 */
export async function runAiVideoLoop(): Promise<void> {
  try {
    const reaped = await reapStaleAiVideoJobs(5).catch((err) => {
      logger.error("ai-video reaper failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as Array<{ brandId: string; sms: string }>;
    });
    for (const r of reaped) {
      logger.warn(`ai-video: reaped stale job for brand ${r.brandId}`);
      await sendToBrand(r.brandId, r.sms).catch((err) => {
        logger.error(`ai-video: failed to SMS brand ${r.brandId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    const results = await runAiVideoJobDrain(2);
    for (const r of results) {
      try {
        logger.info(`ai-video: ready for brand ${r.brandId}`);
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
