import { query, queryOne, type Brand } from "@pulse/shared";
import {
  pendingPlans,
  buildPlanWithFallback,
  markPlanProposed,
  markPlanFailed,
} from "./deps.js";
import { logger } from "../lib/logger.js";

/** Research pending niche plans silently. Dashboard shows the result; SMS only on explicit ask. */
export async function runNichePlanLoop(): Promise<void> {
  const plans = await pendingPlans();
  for (const row of plans) {
    try {
      const brand = await queryOne<Brand>("select * from brands where id = $1", [row.brand_id]);
      if (!brand) {
        await markPlanFailed(row.id);
        continue;
      }
      const preferFast = row.promised_at != null;
      const plan = await buildPlanWithFallback(brand, row.niche ?? brand.name, row.exemplars ?? null, {
        preferFast,
      });
      if (!plan) {
        await query("update content_plans set updated_at = now() where id = $1", [row.id]);
        continue;
      }
      await markPlanProposed(row.id, plan);
    } catch (err) {
      logger.error(`niche plan build failed for ${row.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await query("update content_plans set updated_at = now() where id = $1", [row.id]).catch(() => {});
    }
  }
}
