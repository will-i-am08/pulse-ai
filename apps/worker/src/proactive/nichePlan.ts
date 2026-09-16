import { getServerEnv, query, queryOne, type Brand, type ContentPlan } from "@pulse/shared";
import {
  sendToBrand,
  pendingPlans,
  buildPlanWithFallback,
  markPlanProposed,
  markPlanFailed,
  planTextSummary,
  planOverrunNudge,
  ONBOARDING_PLAN_ETA_MINUTES,
} from "./deps.js";
import { logger } from "../lib/logger.js";

const PLAN_HOLDING_PREFIX = "Still finishing your content plan";

function isOnboardingTimedPlan(row: ContentPlan): boolean {
  return row.promised_at != null;
}

async function holdingRecentlySent(brandId: string): Promise<boolean> {
  const row = await queryOne<{ created_at: string }>(
    `select created_at from messages
      where brand_id = $1 and direction = 'outbound' and body like $2
        and created_at > now() - interval '24 hours'
      order by created_at desc limit 1`,
    [brandId, `${PLAN_HOLDING_PREFIX}%`],
  );
  return !!row;
}

/** Research pending niche plans and deliver proposals via SMS. */
export async function runNichePlanLoop(): Promise<void> {
  const env = getServerEnv();
  const plans = await pendingPlans();
  for (const row of plans) {
    try {
      const brand = await queryOne<Brand>("select * from brands where id = $1", [row.brand_id]);
      if (!brand) {
        await markPlanFailed(row.id);
        continue;
      }
      // Onboarding plans promised a concrete ETA — prefer the fast path.
      const preferFast = isOnboardingTimedPlan(row);
      const plan = await buildPlanWithFallback(brand, row.niche ?? brand.name, row.exemplars ?? null, {
        preferFast,
      });
      if (!plan) {
        await query("update content_plans set updated_at = now() where id = $1", [row.id]);
        if (!(await holdingRecentlySent(brand.id))) {
          await sendToBrand(brand.id, planOverrunNudge(ONBOARDING_PLAN_ETA_MINUTES));
        }
        continue;
      }
      await markPlanProposed(row.id, plan);
      const link = `${env.APP_BASE_URL.replace(/\/$/, "")}/app/content-plan`;
      await sendToBrand(
        brand.id,
        `${planTextSummary(plan)}\n\nFull plan → ${link}\n\nReply yes to use this plan, or tell me what to tweak.`,
      );
    } catch (err) {
      logger.error(`niche plan build failed for ${row.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await query("update content_plans set updated_at = now() where id = $1", [row.id]).catch(() => {});
    }
  }
}
