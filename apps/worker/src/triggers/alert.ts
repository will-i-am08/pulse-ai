import type { SupabaseClient } from "@supabase/supabase-js";
import type { Brand, ProactiveTrigger } from "@pulse/shared";
import { logger } from "../lib/logger.js";
import { operatorPhone } from "../config.js";

export interface FailedPostSummary {
  id: string;
  platform: string;
  last_error: string | null;
}

export interface AlertDeps {
  getFailuresSince: (brandId: string, since: string | null) => Promise<FailedPostSummary[]>;
  sendToBrand: (brandId: string, body: string) => Promise<void>;
  markSent: (triggerId: string) => Promise<void>;
  now: () => Date;
}

/**
 * `alert` trigger: operator-only periodic sweep for posts that ended up `failed` since the
 * last check. This is on top of (not instead of) the immediate per-failure alert the publish
 * loop already sends — this catches anything that failed between operator alerts, and gives
 * a single per-brand digest instead of one text per failed post.
 */
export async function runAlert(brand: Brand, trigger: ProactiveTrigger, deps: AlertDeps): Promise<void> {
  const failures = await deps.getFailuresSince(brand.id, trigger.last_sent_at);
  if (failures.length === 0) {
    await deps.markSent(trigger.id);
    return;
  }

  const lines = failures.map((f) => `- ${f.platform}: ${f.last_error ?? "unknown error"} (post ${f.id})`);
  const body = `Publish failures for "${brand.name}" since last check:\n${lines.join("\n")}`;
  logger.warn(`alerting operator: ${failures.length} failed post(s) for brand ${brand.id}`);
  await deps.sendToBrand(operatorPhone(), body);
  await deps.markSent(trigger.id);
}

export async function getFailuresSince(
  supabase: SupabaseClient,
  brandId: string,
  since: string | null
): Promise<FailedPostSummary[]> {
  let query = supabase
    .from("posts")
    .select("id, platform, last_error, updated_at")
    .eq("brand_id", brandId)
    .eq("status", "failed");
  if (since) query = query.gte("updated_at", since);
  const { data, error } = await query;
  if (error) throw new Error(`getFailuresSince failed: ${error.message}`);
  return (data ?? []) as FailedPostSummary[];
}
