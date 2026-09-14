import { runCreativeRefreshPass, sendToBrand } from "./deps.js";
import { logger } from "../lib/logger.js";

/**
 * Weekly creative refresh — parks 3 look variants from a library photo and SMS.
 * Cap / eligibility live in orchestrator; this loop only delivers.
 */
export async function runCreativeRefreshLoop(): Promise<void> {
  const results = await runCreativeRefreshPass(5);
  for (const r of results) {
    try {
      await sendToBrand(r.brandId, r.sms, r.mediaUrls.length ? r.mediaUrls : undefined);
      logger.info(`creative-refresh sent for brand ${r.brandId}`);
    } catch (err) {
      logger.error(`creative-refresh deliver failed for ${r.brandId}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
