import {
  sendToBrand,
  isDaytime,
  brandsDueForConnectNudge,
  markConnectNudgeSent,
} from "./deps.js";
import { logger } from "../lib/logger.js";

/**
 * Nudge owners who skipped Instagram/Facebook during onboarding.
 * Daytime only; cadence owned by brandsDueForConnectNudge (24h first, then ~3 days, max 4).
 */
export async function runConnectNudgeLoop(): Promise<void> {
  if (!isDaytime(new Date())) return;

  const due = await brandsDueForConnectNudge();
  for (const { brand, message } of due) {
    try {
      await sendToBrand(brand.id, message);
      await markConnectNudgeSent(brand.id);
      logger.info("connect nudge sent", { brandId: brand.id, name: brand.name });
    } catch (err) {
      logger.error("connect nudge failed", {
        brandId: brand.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
