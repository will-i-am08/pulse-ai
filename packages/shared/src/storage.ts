import { query, queryOne } from "./db.js";

// MVP media storage: bytes live in Postgres (media_blobs.bytea) so everything
// stays in Neon with no extra service. The dashboard serves them from a public
// route (/api/media/[id]) so Instagram/Facebook can fetch the image_url when
// publishing. Swap for Neon buckets / S3 later without touching callers.

export async function putMedia(mediaId: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await query(
    `insert into media_blobs (media_id, bytes, content_type)
     values ($1, $2, $3)
     on conflict (media_id) do update set bytes = excluded.bytes, content_type = excluded.content_type`,
    [mediaId, Buffer.from(bytes), contentType],
  );
}

export async function getMedia(mediaId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const row = await queryOne<{ bytes: Buffer; content_type: string }>(
    `select bytes, content_type from media_blobs where media_id = $1`,
    [mediaId],
  );
  return row ? { bytes: row.bytes, contentType: row.content_type } : null;
}

/** Public URL Instagram/Facebook can fetch when publishing. */
export function publicMediaUrl(mediaId: string): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/media/${mediaId}`;
}
