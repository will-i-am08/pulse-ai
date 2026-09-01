import { randomUUID } from "node:crypto";
import { processInbound } from "@pulse/orchestrator";
import {
  MEDIA_BUCKET,
  serviceClient,
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
  const db = serviceClient();
  const { data, error } = await db.from("brands").select("*").eq("client_phone", from).maybeSingle();
  if (error) {
    console.error(`resolveBrandByPhone: lookup failed for ${from}`, error);
    return null;
  }
  return (data as Brand | null) ?? null;
}

function inferMediaKind(contentType: string): MediaKind {
  return contentType.toLowerCase().startsWith("video/") ? "video" : "photo";
}

function extensionFor(contentType: string): string {
  const subtype = contentType.split("/")[1]?.split(";")[0]?.trim();
  return subtype && /^[a-z0-9.-]+$/i.test(subtype) ? subtype : "bin";
}

/** Download provider media and store it under `${brandId}/...` in MEDIA_BUCKET. */
export async function captureMedia(
  brandId: string,
  channel: MessageChannel,
  media: InboundMedia[],
): Promise<MediaAsset[]> {
  if (media.length === 0) return [];
  const db = serviceClient();
  const captured: MediaAsset[] = [];

  for (const item of media) {
    try {
      // Provider media URLs are short-lived — download immediately, never
      // persist the URL itself.
      const { bytes, contentType } = await withBackoff(() => channel.fetchMedia(item), {
        onRetry: (err, attempt) => console.warn(`captureMedia: fetchMedia retry ${attempt} for ${item.url}`, err),
      });

      const storagePath = `${brandId}/${randomUUID()}.${extensionFor(contentType)}`;

      await withBackoff(
        async () => {
          const { error } = await db.storage.from(MEDIA_BUCKET).upload(storagePath, bytes, {
            contentType,
            upsert: false,
          });
          if (error) throw error;
        },
        { onRetry: (err, attempt) => console.warn(`captureMedia: storage upload retry ${attempt} for ${storagePath}`, err) },
      );

      const { data, error } = await db
        .from("media_assets")
        .insert({
          brand_id: brandId,
          storage_path: storagePath,
          kind: inferMediaKind(contentType),
          source: "client",
          content_type: contentType,
        })
        .select("*")
        .single();

      if (error || !data) {
        console.error(`captureMedia: failed to insert media_assets row for ${storagePath}`, error);
        continue;
      }

      captured.push(data as MediaAsset);
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
  const db = serviceClient();

  const { data: brandRow, error: brandError } = await db.from("brands").select("*").eq("id", brandId).maybeSingle();
  if (brandError || !brandRow) {
    console.error(`sendToBrand: brand ${brandId} not found`, brandError);
    return;
  }
  const brand = brandRow as Brand;
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

  const { error: insertError } = await db.from("messages").insert({
    brand_id: brandId,
    direction: "outbound",
    channel: channel.name,
    body,
    provider_message_sid: providerMessageId,
  });
  if (insertError) {
    console.error(`sendToBrand: message sent (sid ${providerMessageId}) but failed to log outbound row`, insertError);
  }
}

/**
 * Handle a normalised inbound message end-to-end: route to brand, persist,
 * capture media to Storage, and hand off to the orchestrator. Never throws —
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

    const db = serviceClient();
    const channel = activeChannel();

    const newMedia = await captureMedia(brand.id, channel, inbound.media);

    const { data: messageRow, error: messageError } = await db
      .from("messages")
      .insert({
        brand_id: brand.id,
        direction: "inbound",
        channel: channel.name,
        body: inbound.body || null,
        media_ids: newMedia.map((m) => m.id),
        provider_message_sid: inbound.providerMessageId || null,
      })
      .select("*")
      .single();

    if (messageError || !messageRow) {
      console.error(`handleInbound: failed to persist inbound message for brand ${brand.id}`, messageError);
      return { brandId: brand.id, messageId: null };
    }

    const message = messageRow as Message;

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
