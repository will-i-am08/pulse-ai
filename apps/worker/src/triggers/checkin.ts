import { query } from "@pulse/shared";
import type { Brand, ProactiveTrigger } from "@pulse/shared";
import { logger } from "../lib/logger.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function isWithinLast24h(timestamp: string | null, now: Date = new Date()): boolean {
  if (!timestamp) return false;
  return now.getTime() - new Date(timestamp).getTime() < ONE_DAY_MS;
}

export interface CheckinDeps {
  getLastInboundAt: (brandId: string) => Promise<string | null>;
  sendToBrand: (brandId: string, body: string) => Promise<void>;
  markSent: (triggerId: string) => Promise<void>;
  now: () => Date;
}

/**
 * `checkin` trigger: weekly "anything to send me this week?" nudge — but SKIP if the brand
 * already messaged in the last 24h (no point asking someone who's already talking to us).
 */
export async function runCheckin(brand: Brand, trigger: ProactiveTrigger, deps: CheckinDeps): Promise<void> {
  const lastInboundAt = await deps.getLastInboundAt(brand.id);
  if (isWithinLast24h(lastInboundAt, deps.now())) {
    logger.info(`skip checkin for brand ${brand.id}: messaged within last 24h`);
    return;
  }
  await deps.sendToBrand(brand.id, "Anything to send me this week?");
  await deps.markSent(trigger.id);
}

export async function getLastInboundAt(brandId: string): Promise<string | null> {
  const rows = await query<{ created_at: string }>(
    `select created_at from messages
     where brand_id = $1 and direction = $2
     order by created_at desc
     limit 1`,
    [brandId, "inbound"],
  );
  return rows[0]?.created_at ?? null;
}
