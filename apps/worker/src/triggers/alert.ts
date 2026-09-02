import { query } from "@pulse/shared";
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

export async function getFailuresSince(brandId: string, since: string | null): Promise<FailedPostSummary[]> {
  const conditions = ["brand_id = $1", "status = $2"];
  const params: unknown[] = [brandId, "failed"];
  if (since) {
    conditions.push(`updated_at >= $${params.length + 1}`);
    params.push(since);
  }
  return query<FailedPostSummary>(
    `select id, platform, last_error from posts where ${conditions.join(" and ")}`,
    params,
  );
}
