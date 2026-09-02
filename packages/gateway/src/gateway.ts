import { randomUUID } from "node:crypto";
import { processInbound } from "@pulse/orchestrator";
import {
  query,
  queryOne,
  putMedia,
  type Brand,
  type InboundMedia,
  type InboundMessage,
  type MediaAsset,
  type MediaKind,
  type Message,
  type MessageChannel,
} from "@pulse/shared";
import { createTwilioChannel } from "@pulse/channel-twilio";
import { withBackoff } from "./backoff.js";

let channelSingleton: MessageChannel | null = null;

/** The active channel singleton (Twilio for now). */
export function activeChannel(): MessageChannel {
  if (!channelSingleton) {
    channelSingleton = createTwilioChannel();
  }
  return channelSingleton;
}

/** Resolve a brand by inbound sender phone (E.164). null if unknown sender. */
export async function resolveBrandByPhone(from: string): Promise<Brand | null> {
  if (!from) return null;
  try {
    return await queryOne<Brand>("select * from brands where client_phone = $1", [from]);
  } catch (err) {
    console.error(`resolveBrandByPhone: lookup failed for ${from}`, err);
    return null;
  }
}

function inferMediaKind(contentType: string): MediaKind {
  return contentType.toLowerCase().startsWith("video/") ? "video" : "photo";
}

/** Download provider media and store its bytes via putMedia (Postgres media_blobs). */
export async function captureMedia(
  brandId: string,
  channel: MessageChannel,
  media: InboundMedia[],
): Promise<MediaAsset[]> {
  if (media.length === 0) return [];
  const captured: MediaAsset[] = [];

  for (const item of media) {
    try {
      // Provider media URLs are short-lived — download immediately, never
      // persist the URL itself.
      const { bytes, contentType } = await withBackoff(() => channel.fetchMedia(item), {
        onRetry: (err, attempt) => console.warn(`captureMedia: fetchMedia retry ${attempt} for ${item.url}`, err),
      });

      // media_assets row first — storage_path is set to the row's own id,
      // which is also the key used to store its bytes via putMedia.
      const mediaId = randomUUID();
      const row = await queryOne<MediaAsset>(
        `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [mediaId, brandId, mediaId, inferMediaKind(contentType), "client", contentType],
      );
      if (!row) {
        console.error(`captureMedia: failed to insert media_assets row for ${mediaId}`);
        continue;
      }

      await withBackoff(() => putMedia(mediaId, bytes, contentType), {
        onRetry: (err, attempt) => console.warn(`captureMedia: putMedia retry ${attempt} for ${mediaId}`, err),
      });

      captured.push(row);
    } catch (err) {
      // A single bad media item should never take down the whole inbound
      // message — log and move on to the rest.
      console.error(`captureMedia: giving up on media item ${item.url}`, err);
    }
  }

  return captured;
}

/** Send an outbound message via the active channel and log it as an outbound Message row. */
export async function sendToBrand(brandId: string, body: string, mediaUrls?: string[]): Promise<void> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) {
    console.error(`sendToBrand: brand ${brandId} not found`);
    return;
  }
  const channel = activeChannel();

  let providerMessageId: string;
  try {
    const result = await withBackoff(() => channel.send({ to: brand.client_phone, body, mediaUrls }), {
      onRetry: (err, attempt) => console.warn(`sendToBrand: send retry ${attempt} for brand ${brandId}`, err),
    });
    providerMessageId = result.providerMessageId;
  } catch (err) {
    console.error(`sendToBrand: send failed after retries for brand ${brandId}`, err);
    return;
  }

  try {
    await query(
      `insert into messages (brand_id, direction, channel, body, provider_message_sid)
       values ($1, $2, $3, $4, $5)`,
      [brandId, "outbound", channel.name, body, providerMessageId],
    );
  } catch (err) {
    console.error(`sendToBrand: message sent (sid ${providerMessageId}) but failed to log outbound row`, err);
  }
}

/**
 * Handle a normalised inbound message end-to-end: route to brand, persist,
 * capture media, and hand off to the orchestrator. Never throws —
 * an unknown sender or any internal failure is logged and results in a null
 * response rather than a crash.
 */
export async function handleInbound(
  inbound: InboundMessage,
): Promise<{ brandId: string | null; messageId: string | null }> {
  try {
    const brand = await resolveBrandByPhone(inbound.from);
    if (!brand) {
      console.warn(`handleInbound: unknown sender ${inbound.from}, dropping inbound message`);
      return { brandId: null, messageId: null };
    }

    const channel = activeChannel();

    const newMedia = await captureMedia(brand.id, channel, inbound.media);

    let message: Message;
    try {
      const row = await queryOne<Message>(
        `insert into messages (brand_id, direction, channel, body, media_ids, provider_message_sid)
         values ($1, $2, $3, $4, $5::uuid[], $6)
         returning *`,
        [
          brand.id,
          "inbound",
          channel.name,
          inbound.body || null,
          newMedia.map((m) => m.id),
          inbound.providerMessageId || null,
        ],
      );
      if (!row) throw new Error("insert returned no row");
      message = row;
    } catch (err) {
      console.error(`handleInbound: failed to persist inbound message for brand ${brand.id}`, err);
      return { brandId: brand.id, messageId: null };
    }

    try {
      const { reply } = await processInbound({ brand, message, newMedia });
      if (reply) {
        await sendToBrand(brand.id, reply);
      }
    } catch (err) {
      // Orchestrator failures must not lose the persisted inbound message.
      console.error(`handleInbound: processInbound failed for brand ${brand.id}, message ${message.id}`, err);
    }

    return { brandId: brand.id, messageId: message.id };
  } catch (err) {
    console.error("handleInbound: unexpected failure", err);
    return { brandId: null, messageId: null };
  }
}
