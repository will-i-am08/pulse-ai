import { query, type Brand } from "@pulse/shared";
import { sendToBrand, isDaytime, buildPerformanceDigest } from "./deps.js";
import { logger } from "../lib/logger.js";

const DIGEST_PREFIX = "📊 Weekly recap";

/**
 * Weekly performance digest for every active brand (SMS). Overlap-guarded by
 * checking for a digest sent in the last 6 days. Natural-language "how did we
 * do?" is handled in processInbound via the same builder.
 */
export async function runWeeklyDigestLoop(): Promise<void> {
  if (!isDaytime(new Date())) return;

  // Fire on Mondays in the brand timezone window: worker TZ is APP TZ.
  const now = new Date();
  if (now.getDay() !== 1) return; // Monday
  // Prefer late morning — skip if before 9 or after 12 local.
  const hour = now.getHours();
  if (hour < 9 || hour >= 12) return;

  const brands = await query<Brand>("select * from brands where status = 'active'");
  for (const brand of brands) {
    try {
      const recent = await query<{ id: string }>(
        `select id from messages
          where brand_id = $1 and direction = 'outbound' and body like $2
            and created_at > now() - interval '6 days'
          limit 1`,
        [brand.id, `${DIGEST_PREFIX}%`],
      );
      if (recent.length > 0) continue;

      const text = await buildPerformanceDigest(brand);
      await sendToBrand(brand.id, text);
    } catch (err) {
      logger.error(`weekly digest failed for brand ${brand.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
