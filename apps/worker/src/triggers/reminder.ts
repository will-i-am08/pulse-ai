import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand, ProactiveTrigger } from "@pulse/shared";
import { logger } from "../lib/logger.js";

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

export interface ReminderDeps {
  getLastMediaReceivedAt: (brandId: string) => Promise<string | null>;
  sendToBrand: (brandId: string, body: string) => Promise<void>;
  markSent: (triggerId: string) => Promise<void>;
  now: () => Date;
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

  logger.info(`sending reminder nudge to brand ${brand.id} (no media since ${lastMediaAt ?? "ever"})`);
  await deps.sendToBrand(
    brand.id,
    "Haven't heard from you in a while — anything to post this week? Send me a pic or video anytime."
  );
  await deps.markSent(trigger.id);
}

export async function getLastMediaReceivedAt(supabase: SupabaseClient, brandId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("media_assets")
    .select("created_at")
    .eq("brand_id", brandId)
    .eq("source", "client")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`getLastMediaReceivedAt failed: ${error.message}`);
  return (data?.[0]?.created_at as string | undefined) ?? null;
}
