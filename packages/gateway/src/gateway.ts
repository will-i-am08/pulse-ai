import { randomUUID } from "node:crypto";
import { processInbound } from "@pulse/orchestrator";
import {
  getServerEnv,
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
let channelOverride: MessageChannel | null = null;

/**
 * Set the active channel explicitly. The Discord bot process calls this at
 * startup with a client-bound DiscordChannel (Discord can't be built from env
 * alone — it needs a live gateway connection).
 */
export function setActiveChannel(channel: MessageChannel): void {
  channelOverride = channel;
}

/** The active messaging channel. Twilio is built from env; Discord is injected by the bot. */
export function activeChannel(): MessageChannel {
  if (channelOverride) return channelOverride;
  if (!channelSingleton) {
    if (getServerEnv().MESSAGE_CHANNEL === "discord") {
      throw new Error("MESSAGE_CHANNEL=discord but no channel injected — the Discord bot must call setActiveChannel()");
    }
    channelSingleton = createTwilioChannel();
  }
  return channelSingleton;
}

/** Resolve a brand by the inbound sender address, using the active channel's addressing. */
export async function resolveBrand(from: string): Promise<Brand | null> {
  return getServerEnv().MESSAGE_CHANNEL === "discord"
    ? resolveBrandByDiscord(from)
    : resolveBrandByPhone(from);
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

/**
 * Resolve a brand by Discord channel/DM id. If none is linked yet, fall back to
 * the configured test brand and stamp this channel onto it, so a first DM just
 * works during testing.
 */
export async function resolveBrandByDiscord(channelId: string): Promise<Brand | null> {
  if (!channelId) return null;
  try {
    const existing = await queryOne<Brand>("select * from brands where discord_channel_id = $1", [channelId]);
    if (existing) return existing;

    const fallbackPhone = getServerEnv().DISCORD_TEST_BRAND_PHONE;
    if (!fallbackPhone) return null;
    const fb = await queryOne<Brand>("select * from brands where client_phone = $1", [fallbackPhone]);
    if (!fb) return null;
    await query("update brands set discord_channel_id = $1 where id = $2", [channelId, fb.id]);
    return { ...fb, discord_channel_id: channelId };
  } catch (err) {
    console.error(`resolveBrandByDiscord: lookup failed for ${channelId}`, err);
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
  const to = getServerEnv().MESSAGE_CHANNEL === "discord" ? brand.discord_channel_id : brand.client_phone;
  if (!to) {
    console.error(`sendToBrand: brand ${brandId} has no address for the active channel`);
    return;
  }

  let providerMessageId: string;
  try {
    const result = await withBackoff(() => channel.send({ to, body, mediaUrls }), {
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
    const brand = await resolveBrand(inbound.from);
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
      // Orchestrator failures must not lose the persisted inbound message — and
      // the client should never be left with silence.
      console.error(`handleInbound: processInbound failed for brand ${brand.id}, message ${message.id}`, err);
      try {
        await sendToBrand(brand.id, "Sorry — I had trouble with that one just now. Mind sending it again?");
      } catch {
        /* best-effort: the send itself may also be down */
      }
    }

    return { brandId: brand.id, messageId: message.id };
  } catch (err) {
    console.error("handleInbound: unexpected failure", err);
    return { brandId: null, messageId: null };
  }
}
