import 'server-only';
import { query, publicMediaUrl } from '@pulse/shared';
import type { MediaAsset } from '@pulse/shared';

export type MediaPreview = MediaAsset & { url: string | null };

/**
 * Media is served publicly from `/api/media/{id}` (bytes live in Postgres,
 * `media_blobs`) — that's also what Meta fetches when publishing, so there's
 * no signing step here any more; just resolve each asset's public URL.
 */
export async function getMediaPreviews(mediaIds: string[]): Promise<MediaPreview[]> {
  if (mediaIds.length === 0) return [];

  const assets = await query<MediaAsset>(`select * from media_assets where id = any($1::uuid[])`, [mediaIds]);

  // Postgres `= any(...)` doesn't preserve order — return in the caller's order.
  const byId = new Map<string, MediaPreview>(
    assets.map((asset) => [asset.id, { ...asset, url: publicMediaUrl(asset.id) }])
  );
  return mediaIds.map((id) => byId.get(id)).filter((a): a is MediaPreview => Boolean(a));
}
