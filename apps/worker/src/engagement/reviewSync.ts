import {
  query,
  queryOne,
  decryptJson,
  googleAccessToken,
  gbpListReviews,
} from "@pulse/shared";
import type { Brand, GbpReview } from "@pulse/shared";
import { createInteraction } from "@pulse/gateway";
import { logger } from "../lib/logger.js";

/**
 * Phase B — Google review sync. Polls each connected brand's GBP location for
 * reviews and feeds unseen ones into `interactions`, where the engagement
 * loop triages them like any other comment (auto / draft / escalate).
 *
 * Safe to run alongside the Discord bot's hourly sync: unseen-ness is checked
 * by review resource name, so a review is never ingested twice. Runs as part
 * of the worker's engagement tick (every 15th minute — reviews don't need
 * minute-level polling).
 */

const STAR_NUM: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface ReviewSyncDeps {
  listGoogleBrands: () => Promise<Brand[]>;
  fetchReviews: (brand: Brand) => Promise<GbpReview[]>;
  isSeen: (externalId: string) => Promise<boolean>;
  create: typeof createInteraction;
}

async function listGoogleBrands(): Promise<Brand[]> {
  return query<Brand>(
    `select * from brands
      where status = 'active'
        and google_tokens_encrypted is not null
        and gbp_location_id is not null`,
  );
}

async function fetchReviews(brand: Brand): Promise<GbpReview[]> {
  const { refresh_token } = decryptJson<{ refresh_token: string }>(brand.google_tokens_encrypted!);
  const token = await googleAccessToken(refresh_token);
  return gbpListReviews(token, `${brand.gbp_account}/${brand.gbp_location_id}`);
}

async function isSeen(externalId: string): Promise<boolean> {
  const seen = await queryOne<{ one: number }>(
    `select 1 as one from interactions where external_id = $1 limit 1`,
    [externalId],
  );
  return !!seen;
}

function realDeps(): ReviewSyncDeps {
  return { listGoogleBrands, fetchReviews, isSeen, create: createInteraction };
}

export function formatReviewText(review: GbpReview): string {
  const stars = STAR_NUM[review.starRating] ?? 3;
  return `(${stars}★) ${review.comment}`;
}

/** Pull new Google reviews for every connected brand into the triage queue. */
export async function runReviewSync(deps: ReviewSyncDeps = realDeps()): Promise<void> {
  let brands: Brand[];
  try {
    brands = await deps.listGoogleBrands();
  } catch (err) {
    logger.error("review sync: failed to list connected brands", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  for (const brand of brands) {
    let reviews: GbpReview[];
    try {
      reviews = await deps.fetchReviews(brand);
    } catch (err) {
      logger.error(`review sync: fetch failed for brand ${brand.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (const review of reviews) {
      try {
        if (await deps.isSeen(review.name)) continue;
        await deps.create(brand, {
          platform: "google",
          kind: "review",
          author: review.reviewer,
          text: formatReviewText(review),
          external_id: review.name,
        });
        logger.info(`review sync: ingested review ${review.reviewId} for brand ${brand.id}`);
      } catch (err) {
        logger.error(`review sync: ingest failed for review ${review.reviewId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
