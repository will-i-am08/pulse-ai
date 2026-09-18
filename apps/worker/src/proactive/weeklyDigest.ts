import { query, type Brand } from "@pulse/shared";
import { readEngagementProfile, shouldRunProactive } from "@pulse/orchestrator";
import { sendToBrand, isDaytime, buildPerformanceDigest } from "./deps.js";
import { logger } from "../lib/logger.js";

const DIGEST_PREFIX = "📊 Weekly recap";

/**
 * Weekly performance digest for every active brand (SMS). Uses the enhanced
 * analyst (format/pillar/timing + organic winners + paid stub). Overlap-guarded
 * by checking for a digest sent in the last 6 days. Natural-language "how did
 * we do?" is handled in processInbound via the same builder.
 *
 * Insight failure → SMS error, not a silently skipped week.
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
      // Owners who turned automatic reports off don't get the weekly recap.
      if (!shouldRunProactive("report", readEngagementProfile(brand))) continue;

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
      try {
        await sendToBrand(
          brand.id,
          "Couldn't build your weekly recap this time — I'll try again next week, or ask me \"how did we do this week?\" anytime.",
        );
      } catch (sendErr) {
        logger.error(`weekly digest error SMS failed for brand ${brand.id}`, {
          error: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
      }
    }
  }
}
