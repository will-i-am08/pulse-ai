import { query } from "@pulse/shared";
import type { Brand, ProactiveTrigger } from "@pulse/shared";
import type { Actionable } from "@pulse/gateway";
import { composeClockSms, readEngagementProfile, shouldRunProactive } from "@pulse/orchestrator";
import { logger } from "../lib/logger.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function isWithinLast24h(timestamp: string | null, now: Date = new Date()): boolean {
  if (!timestamp) return false;
  return now.getTime() - new Date(timestamp).getTime() < ONE_DAY_MS;
}

export interface CheckinDeps {
  getLastInboundAt: (brandId: string) => Promise<string | null>;
  getActionable: (brandId: string) => Promise<Actionable | null>;
  isDaytime: (now: Date) => boolean;
  sendToBrand: (brandId: string, body: string) => Promise<boolean | void>;
  markSent: (triggerId: string) => Promise<void>;
  /** Optional: ledger the send for the engagement learner. */
  recordSend?: (brandId: string) => Promise<void>;
  now: () => Date;
  /** Optional clock brain. Tests stub this; production uses composeClockSms. */
  composeSms?: (brand: Brand, brief: string) => Promise<string>;
}

/**
 * `checkin` trigger: weekly nudge. Time-aware:
 *  - never fires outside sociable hours (retries when daytime comes round);
 *  - SKIPS if the brand already messaged in the last 24h;
 *  - when something's unfinished (a pending draft/campaign/question) it NAMES it
 *    instead of the generic "anything to send me?".
 */
export async function runCheckin(brand: Brand, trigger: ProactiveTrigger, deps: CheckinDeps): Promise<void> {
  if (!shouldRunProactive("checkin", readEngagementProfile(brand))) {
    logger.info(`skip checkin for brand ${brand.id}: engagement set to quiet`);
    return; // no markSent — owner may re-enable, and this stays cheap
  }
  if (!deps.isDaytime(deps.now())) {
    logger.info(`skip checkin for brand ${brand.id}: outside daytime hours`);
    return; // no markSent — retry when it's a sociable hour
  }
  const lastInboundAt = await deps.getLastInboundAt(brand.id);
  if (isWithinLast24h(lastInboundAt, deps.now())) {
    logger.info(`skip checkin for brand ${brand.id}: messaged within last 24h`);
    return;
  }
  const actionable = await deps.getActionable(brand.id);
  const brief = actionable
    ? `Monday-style check-in. They have something unfinished: ${actionable.summary}. Nudge once like a colleague. Do not dump yes/change/no. Do not approve or publish.`
    : `Monday-style check-in. Nothing unfinished. Ask if they want you on anything this week. One short text. No format menu. Do not publish.`;
  const body = await (deps.composeSms ?? composeClockSms)(brand, brief);
  await deps.sendToBrand(brand.id, body);
  await deps.markSent(trigger.id);
  await deps.recordSend?.(brand.id);
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
