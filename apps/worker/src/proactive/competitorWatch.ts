import { queryOne, type Brand } from "@pulse/shared";
import {
  sendToBrand,
  isDaytime,
  dueCompetitorWatches,
  competitorWeeklyUpdate,
  markWatchSwept,
  maybeEnqueueCompetitorDraft,
} from "./deps.js";
import { logger } from "../lib/logger.js";

/** Weekly competitor watch digests via SMS (daytime only). */
export async function runCompetitorWatchLoop(): Promise<void> {
  if (!isDaytime(new Date())) return;
  const due = await dueCompetitorWatches();
  for (const watch of due) {
    try {
      const brand = await queryOne<Brand>(
        "select * from brands where id = $1 and status = 'active'",
        [watch.brand_id],
      );
      if (!brand) continue;
      const { digest, snapshot } = await competitorWeeklyUpdate(brand, watch);
      await markWatchSwept(watch.id, snapshot);
      if (digest) {
        await sendToBrand(brand.id, `👀 Weekly on ${watch.name}:\n\n${digest}`);
        // If they moved, Kip queues its own response-draft kickoff (approval-gated).
        const queued = await maybeEnqueueCompetitorDraft(brand, watch.name, digest);
        if (queued) {
          logger.info(`competitor watch: queued response draft for ${watch.name} / ${brand.id}`);
        }
      }
    } catch (err) {
      logger.error(`competitor watch failed for ${watch.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
