import { serviceClient, MEDIA_BUCKET } from "@pulse/shared";
import { withRetry } from "./retry.js";

/**
 * Resolve `media_assets.id[]` to signed, publicly-fetchable URLs Meta can pull from.
 * We never persist a provider's short-lived URL, but we also never persist ours long-lived
 * either — a fresh 1h signed URL is generated per publish attempt.
 */
export async function resolveMediaUrls(mediaIds: string[]): Promise<string[]> {
  if (mediaIds.length === 0) return [];

  const supabase = serviceClient();
  const { data, error } = await withRetry("media:lookup", async () => {
    const res = await supabase.from("media_assets").select("id, storage_path").in("id", mediaIds);
    if (res.error) throw new Error(res.error.message);
    return res;
  });

  const byId = new Map<string, string>((data ?? []).map((row: any) => [row.id as string, row.storage_path as string]));

  const urls: string[] = [];
  for (const id of mediaIds) {
    const path = byId.get(id);
    if (!path) throw new Error(`resolveMediaUrls: media asset ${id} not found`);
    const signedUrl = await withRetry(`media:sign:${id}`, async () => {
      const res = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
      if (res.error || !res.data?.signedUrl) {
        throw new Error(res.error?.message ?? `failed to sign url for ${path}`);
      }
      return res.data.signedUrl;
    });
    urls.push(signedUrl);
  }
  return urls;
}
