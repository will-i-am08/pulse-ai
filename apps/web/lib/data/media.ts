import 'server-only';
import { serviceClient, MEDIA_BUCKET } from '@pulse/shared';
import type { MediaAsset } from '@pulse/shared';

const SIGNED_URL_TTL_SECONDS = 60 * 10;

export type MediaPreview = MediaAsset & { url: string | null };

/**
 * Media in `MEDIA_BUCKET` is private — never persist provider URLs, never
 * expose the bucket publicly. Sign a short-lived URL per asset for the
 * approval-card preview.
 */
export async function getMediaPreviews(mediaIds: string[]): Promise<MediaPreview[]> {
  if (mediaIds.length === 0) return [];

  const { data, error } = await serviceClient().from('media_assets').select('*').in('id', mediaIds);
  if (error) throw new Error(`getMediaPreviews: ${error.message}`);
  const assets = (data ?? []) as MediaAsset[];

  const withUrls = await Promise.all(
    assets.map(async (asset): Promise<MediaPreview> => {
      const { data: signed, error: signErr } = await serviceClient()
        .storage.from(MEDIA_BUCKET)
        .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
      if (signErr) {
        console.error(`getMediaPreviews: failed to sign ${asset.storage_path}: ${signErr.message}`);
      }
      return { ...asset, url: signed?.signedUrl ?? null };
    })
  );

  // Postgres `in` doesn't preserve order — return in the caller's order.
  const byId = new Map(withUrls.map((a) => [a.id, a]));
  return mediaIds.map((id) => byId.get(id)).filter((a): a is MediaPreview => Boolean(a));
}
