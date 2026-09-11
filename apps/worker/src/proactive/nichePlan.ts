import { getServerEnv, query, queryOne, type Brand } from "@pulse/shared";
import {
  sendToBrand,
  pendingPlans,
  buildPlanWithFallback,
  markPlanProposed,
  markPlanFailed,
  planTextSummary,
} from "./deps.js";
import { logger } from "../lib/logger.js";

const PLAN_HOLDING_PREFIX = "Still working on your content plan";

function planHoldingNudge(): string {
  const templates = [
    `Still working on your content plan — the research is being stubborn but I'm on it. Will send it the moment it lands.`,
    `Content plan's taking longer than expected. Still digging, will ping you the second it's ready.`,
    `Plan research hit a snag, but I'm still going. You'll get it as soon as it's solid.`,
    `Still cooking your content plan. The deep dive is taking a bit, but it's coming.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
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
      const plan = await buildPlanWithFallback(brand, row.niche ?? brand.name, row.exemplars ?? null);
      if (!plan) {
        await query("update content_plans set updated_at = now() where id = $1", [row.id]);
        if (!(await holdingRecentlySent(brand.id))) {
          await sendToBrand(brand.id, planHoldingNudge());
        }
        continue;
      }
      await markPlanProposed(row.id, plan);
      const link = `${env.APP_BASE_URL.replace(/\/$/, "")}/app/content-plan`;
      await sendToBrand(
        brand.id,
        `${planTextSummary(plan)}\n\nFull plan → ${link}\n\nReply "yes" and I'll set it all up, or tell me what to tweak.`,
      );
    } catch (err) {
      logger.error(`niche plan build failed for ${row.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await query("update content_plans set updated_at = now() where id = $1", [row.id]).catch(() => {});
    }
  }
}
