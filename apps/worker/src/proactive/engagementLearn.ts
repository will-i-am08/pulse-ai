import { query, type Brand } from "@pulse/shared";
import { learnEngagementForBrand } from "@pulse/orchestrator";
import { logger } from "../lib/logger.js";

/**
 * Daily engagement-learning pass (Phase 3). Nudges each owner's proactivity
 * dial from how they actually respond — conservatively, and never past the
 * limits an owner set themselves.
 *
 * KIP_ENGAGEMENT_LEARN:
 *   unset / "off" -> loop is dark
 *   "log"         -> compute + log the intended change, write NOTHING (soak)
 *   "on"          -> apply changes
 */

export type LearnMode = "off" | "log" | "on";

export function engagementLearnMode(env = process.env): LearnMode {
  const v = (env.KIP_ENGAGEMENT_LEARN ?? "").toLowerCase();
  if (v === "on") return "on";
  if (v === "log") return "log";
  return "off";
}

export interface EngagementLearnDeps {
  listActiveBrands: () => Promise<Brand[]>;
  learn: (brand: Brand, apply: boolean) => Promise<{ dialChange: unknown; reason: string }>;
  mode: LearnMode;
  now: () => Date;
}

/** Testable core — IO injected. */
export async function runEngagementLearn(deps: EngagementLearnDeps): Promise<void> {
  if (deps.mode === "off") return;
  const apply = deps.mode === "on";
  const brands = await deps.listActiveBrands();
  for (const brand of brands) {
    try {
      const plan = await deps.learn(brand, apply);
      if (plan.dialChange) {
        logger.info(`engagement-learn ${apply ? "applied" : "would apply"}`, {
          brandId: brand.id,
          reason: plan.reason,
        });
      }
    } catch (err) {
      logger.error("engagement-learn failed", {
        brandId: brand.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function listActiveBrands(): Promise<Brand[]> {
  return query<Brand>("select * from brands where status = 'active' order by updated_at desc nulls last limit 1000");
}

/** Wired loop for the worker. */
export async function runEngagementLearnLoop(): Promise<void> {
  const mode = engagementLearnMode();
  if (mode === "off") return;
  await runEngagementLearn({
    listActiveBrands,
    learn: (brand, apply) => learnEngagementForBrand(brand, { apply }),
    mode,
    now: () => new Date(),
  });
}
