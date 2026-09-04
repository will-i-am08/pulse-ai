import { randomUUID } from "node:crypto";
import { processInbound } from "@pulse/orchestrator";
import {
  query,
  queryOne,
  putMedia,
  decryptJson,
  googleAccessToken,
  type Brand,
  type ContentSource,
  type MediaAsset,
  type MediaKind,
  type Message,
} from "@pulse/shared";
import { sendToBrand } from "./gateway.js";
import { withBackoff } from "./backoff.js";

// Auto-pull: poll a brand's connected photo source (Google Photos album / Drive
// folder), import any new media, and run each item through the SAME pipeline a
// texted-in photo uses — draft caption, style, pillar, schedule, notify. A
// pulled photo behaves exactly as if the client had sent it.
//
// NOTE: the provider endpoints/field names below are the documented shapes.
// Google Photos + Drive each need their own API enabled and a read scope on the
// stored token; verify against live access once those scopes are granted.

const MAX_PER_PASS = 4; // don't flood the client with drafts in one sweep
const MAX_ITEM_BYTES = 25_000_000; // skip anything larger than 25 MB

/** A normalised item from any source: enough to dedupe, store, and download. */
type SourceItem = {
  externalId: string;
  contentType: string;
  createdTime: string | null;
  download: () => Promise<Uint8Array>;
};

function inferKind(contentType: string): MediaKind {
  return contentType.toLowerCase().startsWith("video/") ? "video" : "photo";
}

/** Download a provider URL to bytes, enforcing the size cap. */
async function fetchBytes(url: string, headers?: Record<string, string>): Promise<Uint8Array> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`content-source download ${res.status} for ${url.slice(0, 80)}`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len && len > MAX_ITEM_BYTES) throw new Error(`content-source item too large (${len} bytes)`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_ITEM_BYTES) throw new Error(`content-source item too large (${buf.byteLength} bytes)`);
  return buf;
}

/** Google Photos: newest items in an album. */
async function listGooglePhotos(accessToken: string, albumId: string): Promise<SourceItem[]> {
  const res = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:search", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ albumId, pageSize: 25 }),
  });
  const body = (await res.json()) as any;
  if (!res.ok || body.error) throw new Error(`google photos: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  const items: any[] = Array.isArray(body.mediaItems) ? body.mediaItems : [];
  return items
    .filter((m) => m?.id && m?.baseUrl)
    .map((m) => {
      const contentType = String(m.mimeType ?? "image/jpeg");
      const isVideo = contentType.toLowerCase().startsWith("video/");
      // `=d` downloads the full-resolution original; `=dv` for video.
      const url = `${m.baseUrl}=${isVideo ? "dv" : "d"}`;
      return {
        externalId: String(m.id),
        contentType,
        createdTime: m.mediaMetadata?.creationTime ? String(m.mediaMetadata.creationTime) : null,
        download: () => fetchBytes(url),
      };
    });
}

/** Google Drive: newest image/video files in a folder. */
async function listGoogleDrive(accessToken: string, folderId: string): Promise<SourceItem[]> {
  const q = [
    `'${folderId}' in parents`,
    "(mimeType contains 'image/' or mimeType contains 'video/')",
    "trashed = false",
  ].join(" and ");
  const params = new URLSearchParams({
    q,
    fields: "files(id,name,mimeType,createdTime)",
    orderBy: "createdTime desc",
    pageSize: "25",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json()) as any;
  if (!res.ok || body.error) throw new Error(`google drive: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  const files: any[] = Array.isArray(body.files) ? body.files : [];
  return files
    .filter((f) => f?.id)
    .map((f) => ({
      externalId: String(f.id),
      contentType: String(f.mimeType ?? "image/jpeg"),
      createdTime: f.createdTime ? String(f.createdTime) : null,
      download: () =>
        fetchBytes(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`, {
          Authorization: `Bearer ${accessToken}`,
        }),
    }));
}

async function listItems(source: ContentSource, accessToken: string): Promise<SourceItem[]> {
  if (!source.external_ref) return [];
  switch (source.kind) {
    case "google_photos":
      return listGooglePhotos(accessToken, source.external_ref);
    case "google_drive":
      return listGoogleDrive(accessToken, source.external_ref);
    default:
      // dropbox not implemented yet
      return [];
  }
}

/** The refresh token to use for a source: its own if connected, else the brand's Google token. */
function refreshTokenFor(source: ContentSource, brand: Brand): string | null {
  try {
    if (source.encrypted_token) {
      return decryptJson<{ refresh_token: string }>(source.encrypted_token).refresh_token ?? null;
    }
  } catch (err) {
    console.error(`content-source: bad encrypted_token for source ${source.id}`, err);
  }
  try {
    if (brand.google_tokens_encrypted) {
      return decryptJson<{ refresh_token: string }>(brand.google_tokens_encrypted).refresh_token ?? null;
    }
  } catch (err) {
    console.error(`content-source: bad brand google token for ${brand.id}`, err);
  }
  return null;
}

/** Store one pulled item as a media_asset. Returns null if it was already imported. */
async function storeItem(brandId: string, item: SourceItem, bytes: Uint8Array): Promise<MediaAsset | null> {
  const already = await queryOne<{ id: string }>(
    "select id from media_assets where brand_id = $1 and source_external_id = $2 limit 1",
    [brandId, item.externalId],
  );
  if (already) return null;

  const mediaId = randomUUID();
  let row: MediaAsset | null;
  try {
    row = await queryOne<MediaAsset>(
      `insert into media_assets (id, brand_id, storage_path, kind, source, content_type, source_external_id)
       values ($1, $2, $3, $4, 'source', $5, $6)
       on conflict (brand_id, source_external_id) where source_external_id is not null do nothing
       returning *`,
      [mediaId, brandId, mediaId, inferKind(item.contentType), item.contentType, item.externalId],
    );
  } catch (err) {
    console.error(`content-source: failed to insert media row for ${item.externalId}`, err);
    return null;
  }
  if (!row) return null; // lost the dedup race — another pass grabbed it

  await withBackoff(() => putMedia(mediaId, bytes, item.contentType), {
    onRetry: (e, a) => console.warn(`content-source: putMedia retry ${a} for ${mediaId}`, e),
  });
  return row;
}

/** Import + draft new media from one source. Returns how many items it drafted. */
async function importFromSource(brand: Brand, source: ContentSource): Promise<number> {
  const refreshToken = refreshTokenFor(source, brand);
  if (!refreshToken) return 0;

  const accessToken = await googleAccessToken(refreshToken);
  const items = await listItems(source, accessToken);
  let drafted = 0;

  for (const item of items) {
    if (drafted >= MAX_PER_PASS) break;

    // Skip anything we've already imported before spending a download.
    const seen = await queryOne<{ id: string }>(
      "select id from media_assets where brand_id = $1 and source_external_id = $2 limit 1",
      [brand.id, item.externalId],
    );
    if (seen) continue;

    try {
      const bytes = await withBackoff(() => item.download(), {
        onRetry: (e, a) => console.warn(`content-source: download retry ${a} for ${item.externalId}`, e),
      });
      const asset = await storeItem(brand.id, item, bytes);
      if (!asset) continue;

      // Synthesise an inbound message so the pulled photo runs the exact same
      // draft/style/schedule pipeline a texted-in photo does.
      const message = await queryOne<Message>(
        `insert into messages (brand_id, direction, channel, body, media_ids)
         values ($1, 'inbound', 'source', null, $2::uuid[])
         returning *`,
        [brand.id, [asset.id]],
      );
      if (!message) continue;

      const { reply, mediaUrl } = await processInbound({ brand, message, newMedia: [asset] });
      if (reply) {
        const intro = "📸 Pulled a new one from your album —";
        await sendToBrand(brand.id, `${intro}\n\n${reply}`, mediaUrl ? [mediaUrl] : undefined);
      }
      drafted += 1;
    } catch (err) {
      console.error(`content-source: failed to import ${item.externalId} for brand ${brand.id}`, err);
    }
  }

  await query("update content_sources set last_synced_at = now() where id = $1", [source.id]).catch((err) =>
    console.error(`content-source: failed to stamp last_synced_at for ${source.id}`, err),
  );
  return drafted;
}

/**
 * Poll every connected content source across active brands, importing and
 * drafting new media. Never throws — a bad source is logged and skipped. Meant
 * to be called on an interval by the bot (which has the native imaging libs).
 */
export async function importFromContentSources(): Promise<number> {
  let total = 0;
  const sources = await query<ContentSource>(
    `select cs.* from content_sources cs
       join brands b on b.id = cs.brand_id
      where b.status = 'active'`,
  );
  for (const source of sources) {
    try {
      const brand = await queryOne<Brand>("select * from brands where id = $1", [source.brand_id]);
      if (!brand) continue;
      total += await importFromSource(brand, source);
    } catch (err) {
      console.error(`content-source: sync failed for source ${source.id}`, err);
    }
  }
  return total;
}
