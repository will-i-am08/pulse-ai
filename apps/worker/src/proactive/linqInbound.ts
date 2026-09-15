import { query, queryOne, type InboundMedia, type Message } from "@pulse/shared";
import {
  createLinqChannel,
  resolveBrandByLinq,
  captureMedia,
  startTypingKeeper,
  processInbound,
} from "./deps.js";
import { logger } from "../lib/logger.js";

/**
 * Drain Linq pending_inbound rows (webhook only enqueues). Overlap-safe via
 * atomic status claim. Required when MESSAGE_CHANNEL=linq so inbound isn't
 * stranded after Discord removal.
 *
 * Claim with `processing` (not `done`) so a failed capture / missing brand
 * cannot mark a photo row done forever without landing media_assets.
 */
export async function runLinqInboundLoop(): Promise<void> {
  const rows = await query<{
    id: string;
    from_handle: string;
    body: string | null;
    media: InboundMedia[];
    provider_message_id: string | null;
    chat_id: string | null;
  }>(
    "select * from pending_inbound where channel = 'linq' and status = 'new' order by created_at asc limit 10",
  );
  if (rows.length === 0) return;

  const linq = createLinqChannel();
  for (const row of rows) {
    const claimed = await query<{ id: string }>(
      "update pending_inbound set status = 'processing' where id = $1 and status = 'new' returning id",
      [row.id],
    );
    if (claimed.length === 0) continue;

    if (row.chat_id) linq.noteChat(row.from_handle, row.chat_id);
    const keeper = startTypingKeeper(linq, row.from_handle);
    try {
      const brand = await resolveBrandByLinq(row.from_handle);
      if (!brand) {
        logger.warn(`linq inbound: unknown sender ${row.from_handle}, failing ${row.id}`);
        await query("update pending_inbound set status = 'failed' where id = $1", [row.id]).catch(() => {});
        continue;
      }
      const media = Array.isArray(row.media) ? row.media : [];
      const newMedia = await captureMedia(brand.id, linq, media);
      if (media.length > 0 && newMedia.length === 0) {
        logger.error(`linq inbound: media capture failed for ${row.id}`);
        await linq
          .send({
            to: brand.client_phone,
            body: "Got your text but I couldn't download the photo — mind sending the image one more time?",
          })
          .catch(() => {});
        await query("update pending_inbound set status = 'failed' where id = $1", [row.id]).catch(() => {});
        continue;
      }
      const message = await queryOne<Message>(
        `insert into messages (brand_id, direction, channel, body, media_ids, provider_message_sid)
         values ($1, 'inbound', 'linq', $2, $3::uuid[], $4) returning *`,
        [brand.id, row.body ?? null, newMedia.map((m) => m.id), row.provider_message_id ?? null],
      );
      if (!message) {
        await query("update pending_inbound set status = 'failed' where id = $1", [row.id]).catch(() => {});
        continue;
      }
      if (newMedia.some((m) => m.kind === "photo")) {
        await linq
          .send({
            to: brand.client_phone,
            body: "Got it, styling your photo and writing your caption, one sec ✨",
          })
          .catch(() => {});
      }
      const { reply, mediaUrl, mediaUrls } = await processInbound({ brand, message, newMedia });
      if (reply) {
        await linq.send({
          to: brand.client_phone,
          body: reply,
          mediaUrls: mediaUrls?.length ? mediaUrls : mediaUrl ? [mediaUrl] : undefined,
        });
      }
      await query("update pending_inbound set status = 'done' where id = $1", [row.id]);
    } catch (err) {
      logger.error(`linq inbound processing failed for ${row.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      await query("update pending_inbound set status = 'failed' where id = $1", [row.id]).catch(() => {});
    } finally {
      keeper.stop();
    }
  }
}
