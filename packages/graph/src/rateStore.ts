import { queryOne } from "@pulse/shared";
import type { Brand, Platform } from "@pulse/shared";

/**
 * Count of this brand's posts published to `platform` in the last 24h, per our own
 * publish ledger (the `posts` table). This is the source of truth for rate limiting
 * in both Mock and Live modes — Meta's Graph API doesn't expose a "posts published in
 * the last N hours" endpoint, so we track it ourselves.
 */
export async function countPublished24h(brand: Brand, platform: Platform): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    const row = await queryOne<{ count: string }>(
      `select count(*) as count
       from posts
       where brand_id = $1
         and platform = $2
         and status = $3
         and published_at >= $4`,
      [brand.id, platform, "published", since],
    );
    return Number(row?.count ?? 0);
  } catch (err) {
    throw new Error(
      `countPublished24h failed for brand ${brand.id}/${platform}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
