import { randomUUID } from "node:crypto";
import { processInbound, finishOnboarding } from "@pulse/orchestrator";
import {
  getServerEnv,
  kipContactIdentity,
  query,
  queryOne,
  putMedia,
  sanitizeChatText,
  type Brand,
  type InboundMedia,
  type InboundMessage,
  type MediaAsset,
  type MediaKind,
  type Message,
  type MessageChannel,
} from "@pulse/shared";
import { createTwilioChannel } from "@pulse/channel-twilio";
import { createLinqChannel } from "./linq-channel.js";
import { withBackoff } from "./backoff.js";

let channelSingleton: MessageChannel | null = null;
let channelOverride: MessageChannel | null = null;

/** Opaque handle for an in-flight typing indicator loop. Call stop() when done. */
export interface TypingKeeper {
  stop(): void;
}

/**
 * Keep a channel's "... is typing" indicator alive while async work runs.
 * Best-effort: channels without sendTyping (plain SMS) no-op. The indicator
 * interval is per-channel (Discord expires after ~10s, Linq after ~85-90s).
 * Never throws; stopping is idempotent.
 */
export function startTypingKeeper(channel: MessageChannel, to: string): TypingKeeper {
  let stopped = false;
  const intervalMs = channel.name === "linq" ? 60_000 : 8_000;
  const tick = (): void => {
    if (stopped || !to) return;
    try {
      const p = channel.sendTyping?.(to);
      (p as Promise<unknown> | undefined)?.catch?.(() => {});
    } catch {
      /* best-effort */
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  // Don't hold the process open for typing loops (serverless + bot ticks).
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split a long reply into chat-bubble-sized chunks on sentence boundaries,
 * so paced SMS sends feel human. URLs and short texts pass through untouched.
 */
export function splitIntoBubbles(body: string, softMax = 320): string[] {
  const text = (body ?? "").trim();
  if (!text || text.length <= softMax) return [text];
  const sentences = text.split(/(?<=[.!?…\n])\s+/);
  const chunks: string[] = [];
  let cur = "";
  const push = (): void => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const s of sentences) {
    if (!cur || `${cur} ${s}`.trim().length <= softMax) {
      cur = cur ? `${cur} ${s}` : s;
    } else if (s.length > softMax) {
      push();
      // Hard-split an over-long sentence on word boundaries.
      const words = s.split(/\s+/);
      let w = "";
      for (const word of words) {
        if (!w || `${w} ${word}`.trim().length <= softMax) {
          w = w ? `${w} ${word}` : word;
        } else {
          chunks.push(w);
          w = word;
        }
      }
      cur = w;
    } else {
      push();
      cur = s;
    }
  }
  push();
  return chunks.filter(Boolean);
}

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
    const which = getServerEnv().MESSAGE_CHANNEL;
    if (which === "discord") {
      throw new Error("MESSAGE_CHANNEL=discord but no channel injected — the Discord bot must call setActiveChannel()");
    }
    channelSingleton = which === "linq" ? createLinqChannel() : createTwilioChannel();
  }
  return channelSingleton;
}

/** Resolve a brand by the inbound sender address, using the active channel's addressing. */
export async function resolveBrand(from: string): Promise<Brand | null> {
  const which = getServerEnv().MESSAGE_CHANNEL;
  if (which === "discord") return resolveBrandByDiscord(from);
  if (which === "linq") return resolveBrandByLinq(from);
  return resolveBrandByPhone(from);
}

/**
 * Resolve a brand by the Linq sender phone. If none matches and a sandbox test
 * brand is configured, link this phone to it (first-message auto-link) so you
 * can play immediately from your own phone.
 */
export async function resolveBrandByLinq(from: string): Promise<Brand | null> {
  if (!from) return null;
  try {
    const existing = await queryOne<Brand>("select * from brands where client_phone = $1", [from]);
    if (existing) return existing;

    const testBrandId = getServerEnv().LINQ_TEST_BRAND_ID;
    if (!testBrandId) return null;
    const fb = await queryOne<Brand>("select * from brands where id = $1", [testBrandId]);
    if (!fb) return null;
    await query("update brands set client_phone = $1 where id = $2", [from, fb.id]);
    return { ...fb, client_phone: from };
  } catch (err) {
    console.error(`resolveBrandByLinq: lookup failed for ${from}`, err);
    return null;
  }
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

/** True when this brand has not yet been sent Kip's Twilio MMS contact card. */
function needsTwilioContactCard(brand: Brand): boolean {
  const sent = brand.onboarding_state?.kip_contact_card_sent_at;
  return typeof sent !== "string" || sent.length === 0;
}

/** Stamp kip_contact_card_sent_at so we only MMS the vCard once per brand. */
async function markTwilioContactCardSent(brandId: string): Promise<void> {
  try {
    await query(
      `update brands
          set onboarding_state = jsonb_set(
                coalesce(onboarding_state, '{}'::jsonb),
                '{kip_contact_card_sent_at}',
                to_jsonb(now()::text)
              )
        where id = $1`,
      [brandId],
    );
  } catch (err) {
    console.warn(`sendToBrand: failed to mark contact card sent for ${brandId}`, err);
  }
}

/**
 * Send an outbound message via the active channel and log it as an outbound Message row.
 * Returns true when at least one part was handed to the provider successfully.
 * Callers that must not mark work done on a silent failure (e.g. OTP delivery)
 * should check the boolean — this function does not throw on send failure.
 */
export async function sendToBrand(
  brandId: string,
  body: string,
  mediaUrls?: string[],
  opts?: { pace?: boolean },
): Promise<boolean> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) {
    console.error(`sendToBrand: brand ${brandId} not found`);
    return false;
  }
  const channel = activeChannel();
  const which = getServerEnv().MESSAGE_CHANNEL;
  const to = which === "discord" ? brand.discord_channel_id : brand.client_phone;
  if (!to) {
    console.error(`sendToBrand: brand ${brandId} has no address for the active channel`);
    return false;
  }

  const text = sanitizeChatText(body);
  // Channels with a native typing indicator (Discord, Linq/iMessage) already
  // show liveness — pacing is the SMS stand-in (SMS has no typing signal).
  const hasNativeTyping = typeof channel.sendTyping === "function";
  const pace = (opts?.pace ?? true) && !hasNativeTyping;
  // Never split captioned media: the text + image ride together as one MMS.
  const parts = pace && (!mediaUrls || mediaUrls.length === 0) ? splitIntoBubbles(text) : [text];

  // Twilio can't do iMessage Name-and-Photo Sharing — attach a Kip.vcf MMS on
  // the first outbound so the client can save name + cat logo from setup/OTP.
  const attachTwilioCard = which === "twilio" && channel.name === "twilio-sms" && needsTwilioContactCard(brand);
  const vcardUrl = attachTwilioCard ? kipContactIdentity().vcardUrl : null;
  let twilioCardAttached = false;

  let sentAny = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    let partMedia = i === parts.length - 1 ? mediaUrls : undefined;
    if (vcardUrl && i === 0) {
      partMedia = [...(partMedia ?? []), vcardUrl];
      twilioCardAttached = true;
    }
    if (pace) {
      // Typing pause before each bubble: longer for longer texts (capped),
      // plus a breath between consecutive bubbles.
      const typingPause = Math.min(700 + part.length * 25, i === 0 ? 2500 : 1200);
      await sleep(typingPause + (i > 0 ? 600 : 0));
    }
    let providerMessageId: string;
    try {
      const result = await withBackoff(() => channel.send({ to, body: part, mediaUrls: partMedia }), {
        onRetry: (err, attempt) => console.warn(`sendToBrand: send retry ${attempt} for brand ${brandId}`, err),
      });
      providerMessageId = result.providerMessageId;
      sentAny = true;
    } catch (err) {
      console.error(`sendToBrand: send failed after retries for brand ${brandId}`, err);
      return sentAny;
    }

    // Only mark after a successful send that actually included the vCard.
    if (twilioCardAttached && i === 0) {
      await markTwilioContactCardSent(brandId);
      twilioCardAttached = false;
    }

    try {
      await query(
        `insert into messages (brand_id, direction, channel, body, provider_message_sid)
       values ($1, $2, $3, $4, $5)`,
        [brandId, "outbound", channel.name, part, providerMessageId],
      );
    } catch (err) {
      console.error(`sendToBrand: message sent (sid ${providerMessageId}) but failed to log outbound row`, err);
    }
  }
  return sentAny;
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
  // Liveness from the first millisecond: keeper targets the sender address
  // directly (Discord channel id / sender phone both equal inbound.from), so it
  // can start before brand resolution. Twilio SMS no-ops here (paced sends +
  // holding text below are its stand-in). Never let typing break the pipeline.
  let keeper: TypingKeeper | null = null;
  try {
    try {
      keeper = startTypingKeeper(activeChannel(), inbound.from);
    } catch {
      keeper = null;
    }
    const brand = await resolveBrand(inbound.from);
    if (!brand) {
      console.warn(`handleInbound: unknown sender ${inbound.from}, dropping inbound message`);
      return { brandId: null, messageId: null };
    }

    // Idempotency: a provider (Discord reconnect, Twilio retry) can redeliver the
    // same message. If we've already stored this provider id, skip — otherwise we'd
    // draft, generate, and reply twice.
    if (inbound.providerMessageId) {
      const seen = await queryOne<{ id: string }>(
        "select id from messages where provider_message_sid = $1 limit 1",
        [inbound.providerMessageId],
      );
      if (seen) {
        console.warn(`handleInbound: duplicate provider message ${inbound.providerMessageId}, skipping`);
        return { brandId: brand.id, messageId: seen.id };
      }
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

    // Styling a photo takes a moment — reassure the client first.
    const photoAckSent = newMedia.some((m) => m.kind === "photo");
    if (photoAckSent) {
      await sendToBrand(brand.id, "Got it, styling your photo and writing your caption, one sec ✨", undefined, {
        pace: false,
      }).catch(() => {});
    }

    // Slow-work safety net for channels WITHOUT a native typing indicator
    // (plain SMS): if the orchestrator is still thinking after a few seconds,
    // say so — otherwise the client stares at silence. Skipped when the photo
    // ack above already went out, and when native typing covers liveness.
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      if (!photoAckSent && typeof channel.sendTyping !== "function") {
        slowTimer = setTimeout(() => {
          sendToBrand(brand.id, "On it, one sec…", undefined, { pace: false }).catch(() => {});
        }, 4500);
        (slowTimer as unknown as { unref?: () => void }).unref?.();
      }
      const { reply, mediaUrl, finishOnboardingBrandId } = await processInbound({ brand, message, newMedia });
      if (reply) {
        await sendToBrand(brand.id, reply, mediaUrl ? [mediaUrl] : undefined);
      }
      // Onboarding just completed: the ack is already with the owner. Now do
      // the slow compile and deliver the rundown as a second message.
      if (finishOnboardingBrandId) {
        try {
          const rundown = await finishOnboarding(finishOnboardingBrandId);
          await sendToBrand(finishOnboardingBrandId, rundown);
        } catch (err) {
          console.error(`handleInbound: finishOnboarding failed for brand ${finishOnboardingBrandId}`, err);
          await sendToBrand(
            finishOnboardingBrandId,
            "Writing your voice up hit a snag on my end. Your answers are saved, I'll have the rundown to you shortly.",
          ).catch(() => {});
        }
      }
    } catch (err) {
      // Orchestrator failures must not lose the persisted inbound message — and
      // the client should never be left with silence.
      console.error(`handleInbound: processInbound failed for brand ${brand.id}, message ${message.id}`, err);
      try {
        await sendToBrand(brand.id, "Sorry, I had trouble with that one just now. Mind sending it again?");
      } catch {
        /* best-effort: the send itself may also be down */
      }
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
    }

    return { brandId: brand.id, messageId: message.id };
  } catch (err) {
    console.error("handleInbound: unexpected failure", err);
    return { brandId: null, messageId: null };
  } finally {
    keeper?.stop();
  }
}
