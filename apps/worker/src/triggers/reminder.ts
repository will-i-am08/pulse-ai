import { query } from "@pulse/shared";
import type { Brand, ProactiveTrigger } from "@pulse/shared";
import { composeClockSms } from "@pulse/orchestrator";
import { logger } from "../lib/logger.js";

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

export interface ReminderDeps {
  getLastMediaReceivedAt: (brandId: string) => Promise<string | null>;
  sendToBrand: (brandId: string, body: string) => Promise<boolean | void>;
  markSent: (triggerId: string) => Promise<void>;
  now: () => Date;
  isDaytime?: (now: Date) => boolean;
  composeSms?: (brand: Brand, brief: string) => Promise<string>;
}

/**
 * True when the brand has gone >=10 days without sending media AND we haven't already
 * nudged them during this quiet spell. `last_sent_at` predating the last received media
 * means the clock has since reset (they sent something, then went quiet again) — so a
 * later `last_sent_at` blocks a repeat nudge for the current quiet spell.
 */
export function shouldSendReminder(lastMediaAt: string | null, lastSentAt: string | null, now: Date): boolean {
  const staleSinceMs = lastMediaAt ? new Date(lastMediaAt).getTime() : -Infinity;
  const isStale = now.getTime() - staleSinceMs >= TEN_DAYS_MS;
  if (!isStale) return false;

  const alreadyNudgedThisSpell =
    !!lastSentAt && (!lastMediaAt || new Date(lastSentAt).getTime() >= new Date(lastMediaAt).getTime());
  return !alreadyNudgedThisSpell;
}

/** `reminder` trigger: if no media received in 10 days, send ONE nudge. */
export async function runReminder(brand: Brand, trigger: ProactiveTrigger, deps: ReminderDeps): Promise<void> {
  const lastMediaAt = await deps.getLastMediaReceivedAt(brand.id);
  const now = deps.now();
  if (!shouldSendReminder(lastMediaAt, trigger.last_sent_at, now)) return;
  if (deps.isDaytime && !deps.isDaytime(now)) {
    logger.info(`skip reminder for brand ${brand.id}: outside daytime hours`);
    return;
  }

  logger.info(`sending reminder nudge to brand ${brand.id} (no media since ${lastMediaAt ?? "ever"})`);
  const brief = `They have gone quiet for 10+ days with no photo. Nudge once like a colleague. Ask if they want to post this week. No yes/change/no menu. Do not publish.`;
  const body = await (deps.composeSms ?? composeClockSms)(brand, brief);
  await deps.sendToBrand(brand.id, body);
  await deps.markSent(trigger.id);
}

export async function getLastMediaReceivedAt(brandId: string): Promise<string | null> {
  const rows = await query<{ created_at: string }>(
    `select created_at from media_assets
     where brand_id = $1 and source = $2
     order by created_at desc
     limit 1`,
    [brandId, "client"],
  );
  return rows[0]?.created_at ?? null;
}
