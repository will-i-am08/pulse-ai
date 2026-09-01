import { serviceClient } from "@pulse/shared";
import type { Brand, Platform } from "@pulse/shared";

/**
 * Count of this brand's posts published to `platform` in the last 24h, per our own
 * publish ledger (the `posts` table). This is the source of truth for rate limiting
 * in both Mock and Live modes — Meta's Graph API doesn't expose a "posts published in
 * the last N hours" endpoint, so we track it ourselves.
 */
export async function countPublished24h(brand: Brand, platform: Platform): Promise<number> {
  const supabase = serviceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brand.id)
    .eq("platform", platform)
    .eq("status", "published")
    .gte("published_at", since);

  if (error) {
    throw new Error(`countPublished24h failed for brand ${brand.id}/${platform}: ${error.message}`);
  }
  return count ?? 0;
}
