import { query, publicMediaUrl } from "@pulse/shared";
import { withRetry } from "./retry.js";

/**
 * Resolve `media_assets.id[]` (scoped to `brandId`) to the public URLs Meta fetches when
 * publishing — `publicMediaUrl(id)` -> `${APP_BASE_URL}/api/media/{id}`, served by the
 * dashboard's public media route backed by `media_blobs`. No signing needed: the route
 * itself is public, so the URL is stable and deterministic.
 */
export async function resolveMediaUrls(brandId: string, mediaIds: string[]): Promise<string[]> {
  if (mediaIds.length === 0) return [];

  const rows = await withRetry("media:lookup", () =>
    query<{ id: string }>(
      `select id from media_assets where brand_id = $1 and id = any($2::uuid[])`,
      [brandId, mediaIds],
    )
  );

  const found = new Set(rows.map((row) => row.id));
  const urls: string[] = [];
  for (const id of mediaIds) {
    if (!found.has(id)) throw new Error(`resolveMediaUrls: media asset ${id} not found`);
    urls.push(publicMediaUrl(id));
  }
  return urls;
}
