import { query, type Brand } from "@pulse/shared";
import { syncAdPerformance } from "@pulse/orchestrator";
import { sendToBrand, sendToOperator } from "@pulse/gateway";
import { logger } from "../lib/logger.js";

/**
 * Periodically sync Meta ads insights, pause at spend caps, SMS the brand,
 * and mirror cap breaches to OPERATOR_PHONE when set.
 */
export async function runAdsSyncLoop(): Promise<void> {
  const brands = await query<Brand>(
    `select * from brands
      where status = 'active'
        and coalesce((features->>'ads')::boolean, false) = true
        and ads_tokens_encrypted is not null
      order by updated_at desc
      limit 25`,
  );
  for (const brand of brands) {
    try {
      const { alerts, suggestions } = await syncAdPerformance(brand);
      for (const a of alerts) {
        await sendToBrand(brand.id, a);
        await sendToOperator(`Ad alert — ${brand.name}: ${a}`);
      }
      for (const s of suggestions.slice(0, 2)) {
        await sendToBrand(brand.id, s);
      }
      if (alerts.length || suggestions.length) {
        logger.info(`ads-sync brand=${brand.id} alerts=${alerts.length} suggestions=${suggestions.length}`);
      }
    } catch (err) {
      logger.error(`ads-sync failed for ${brand.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
