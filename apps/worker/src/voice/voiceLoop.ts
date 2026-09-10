import { query } from "@pulse/shared";
import type { Brand } from "@pulse/shared";
import { runVoiceAnalysis } from "@pulse/orchestrator";
import { logger } from "../lib/logger.js";

// Picks up brands whose voice analysis was queued at connect time and runs it.
// One brand per tick keeps the (LLM- and image-heavy) work from stampeding; the
// queue drains steadily. runVoiceAnalysis records its own success/failure state.

async function claimNext(): Promise<Brand | null> {
  // Atomically claim one pending brand by flipping it to running, so overlapping
  // ticks (or multiple workers) never grab the same one.
  const rows = await query<Brand>(
    `update brands set voice_analysis_state = voice_analysis_state
        || jsonb_build_object('status','running','started_at', to_jsonb(now()::text))
     where id = (
       select id from brands
       where voice_analysis_state->>'status' = 'pending'
       order by (voice_analysis_state->>'queued_at') asc nulls first
       limit 1
       for update skip locked
     )
     returning *`,
  );
  return rows[0] ?? null;
}

export async function runVoiceLoop(): Promise<void> {
  const brand = await claimNext();
  if (!brand) return;
  logger.info("voice loop: analysing brand voice", { brandId: brand.id, name: brand.name });
  const result = await runVoiceAnalysis(brand.id);
  logger.info("voice loop: analysis finished", {
    brandId: brand.id,
    status: result.status,
    posts: result.posts_analysed,
    images: result.images_analysed,
    platforms: result.platforms,
    error: result.error,
  });
}
