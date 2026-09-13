import { randomUUID } from "node:crypto";
import {
  processInbound,
  finishOnboarding,
  craftHumanAck,
  stripLeadingAck,
  looksLikeAffirmation,
  buildOnboardingPlanSms,
  planOverrunNudge,
  ONBOARDING_PLAN_ETA_MINUTES,
} from "@pulse/orchestrator";
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
import { claimContactCardSent, needsContactCard, releaseContactCardSent } from "./contactCardSent.js";

let channelSingleton: MessageChannel | null = null;
let channelOverride: MessageChannel | null = null;

/** Opaque handle for an in-flight typing indicator loop. Call stop() when done. */
export interface TypingKeeper {
  stop(): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Quiet window so rapid SMS from one owner become a single turn. */
const INBOUND_BURST_MS = 2800;

/** Instant plain-text acks are for post-setup chat only — and never for pure vibes. */
export function shouldSendInstantTextAck(
  brand: Pick<Brand, "onboarding_state">,
  inboundText: string,
): boolean {
  const status = brand.onboarding_state?.status;
  if (
    status === "pending" ||
    status === "awaiting_contact" ||
    status === "awaiting_connect" ||
    status === "reading_content" ||
    status === "in_progress" ||
    status === "wrapping_up"
  ) {
    return false;
  }
  const t = (inboundText ?? "").trim();
  if (!t) return false;
  // Affirmations / thanks get a real reply — no separate "Got you, Bill." SMS.
  if (looksLikeAffirmation(t)) return false;
  // Status checks ("are you done?") — let the real reply speak, don't fake-wrap.
  if (
    /^(are you )?(done|finished|ready)\b/i.test(t) ||
    /\b(done|finished|ready) yet\b/i.test(t) ||
    /\bstill (there|working|reading|going)\b/i.test(t)
  ) {
    return false;
  }
  // Plan rebuild asks / scratch confirms — avoid a lone "Got you" while research runs;
  // the plan SMS (or a real holding line) is the reply.
  if (
    /^(from\s+)?scratch\b/i.test(t) ||
    /\b(content|niche)\s+plan\b/i.test(t) ||
    /\bplan\b[\s\S]{0,20}\b(build|rebuild|re-?run)\b/i.test(t) ||
    /\b(re-?run|re-?build|re-?do)\b[\s\S]{0,40}\bplan\b/i.test(t)
  ) {
    return false;
  }
  return true;
}


/**
 * Keep a channel's "... is typing" indicator alive while async work runs.
 * Best-effort: channels without sendTyping (plain SMS) no-op. The indicator
 * interval is per-channel (Linq after ~85-90s; others ~10s).
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

/**
 * Split a long reply into chat-bubble-sized chunks on sentence boundaries,
 * so paced SMS sends feel human. URLs and short texts pass through untouched.
 */
export function splitIntoBubbles(body: string, softMax = 320): string[] {
  const text = (body ?? "").trim();
  if (!text) return [];

  // Prefer paragraph breaks first so intentional SMS beats stay intact —
  // even when the whole body is under softMax.
  const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length > 1) {
    const out: string[] = [];
    for (const para of paragraphs) {
      out.push(...splitIntoBubbles(para, softMax));
    }
    return out;
  }

  if (text.length <= softMax) return [text];

  const sentences = text.split(/(?<=[.!?…])\s+/);
  const chunks: string[] = [];
  let cur = "";
  const push = (): void => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  // Allow modest overflow so we don't tear a sentence mid-thought.
  const hardMax = Math.round(softMax * 1.45);
  for (const s of sentences) {
    const next = cur ? `${cur} ${s}` : s;
    if (!cur || next.length <= softMax) {
      cur = next;
    } else if (s.length > hardMax) {
      push();
      const words = s.split(/\s+/);
      let w = "";
      for (const word of words) {
        if (!w || `${w} ${word}`.length <= softMax) {
          w = w ? `${w} ${word}` : word;
        } else {
          chunks.push(w);
          w = word;
        }
      }
      cur = w;
    } else if (next.length <= hardMax) {
      // Keep the sentence with the prior bubble rather than orphaning it.
      cur = next;
    } else {
      push();
      cur = s;
    }
  }
  push();
  return chunks.filter(Boolean);
}

/**
 * Set the active channel explicitly (e.g. lab channel in tests / dashboard).
 * Production Twilio/Linq channels are built from env via activeChannel().
 */
export function setActiveChannel(channel: MessageChannel): void {
  channelOverride = channel;
}

/** The active messaging channel — Twilio (default) or Linq from MESSAGE_CHANNEL. */
export function activeChannel(): MessageChannel {
  if (channelOverride) return channelOverride;
  if (!channelSingleton) {
    const which = getServerEnv().MESSAGE_CHANNEL;
    channelSingleton = which === "linq" ? createLinqChannel() : createTwilioChannel();
  }
  return channelSingleton;
}

/** Resolve a brand by the inbound sender address, using the active channel's addressing. */
export async function resolveBrand(from: string): Promise<Brand | null> {
  const which = getServerEnv().MESSAGE_CHANNEL;
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
  opts?: { pace?: boolean; channel?: MessageChannel },
): Promise<boolean> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) {
    console.error(`sendToBrand: brand ${brandId} not found`);
    return false;
  }
  const channel = opts?.channel ?? activeChannel();
  // Twilio, Linq, and lab all address the owner by phone (E.164).
  const to = brand.client_phone;
  if (!to) {
    console.error(`sendToBrand: brand ${brandId} has no client_phone`);
    return false;
  }

  const text = sanitizeChatText(body);
  // Channels with a native typing indicator (Linq/iMessage) already show
  // liveness — pacing is the SMS stand-in (SMS has no typing signal).
  const hasNativeTyping = typeof channel.sendTyping === "function";
  const pace = (opts?.pace ?? true) && !hasNativeTyping;
  // Never split captioned media: the text + image ride together as one MMS.
  const parts = pace && (!mediaUrls || mediaUrls.length === 0) ? splitIntoBubbles(text) : [text];

  // Twilio can't do iMessage Name-and-Photo Sharing — attach a Kip.vcf MMS on
  // the first outbound so the client can save name + cat logo from setup/OTP.
  // Claim atomically so concurrent sends (ack + reply) only attach once, and
  // so onboarding JSON rewrites cannot wipe the flag and re-attach later.
  let claimedTwilioCard = false;
  if (channel.name === "twilio-sms" && needsContactCard(brand)) {
    claimedTwilioCard = !!(await claimContactCardSent(brandId));
  }
  const vcardUrl = claimedTwilioCard ? kipContactIdentity().vcardUrl : null;

  let sentAny = false;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    let partMedia = i === parts.length - 1 ? mediaUrls : undefined;
    if (vcardUrl && i === 0) {
      partMedia = [...(partMedia ?? []), vcardUrl];
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
      // Release so a later successful outbound can still deliver the vCard.
      if (claimedTwilioCard && i === 0) {
        await releaseContactCardSent(brandId);
        claimedTwilioCard = false;
      }
      return sentAny;
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
 * SMS the operator phone (OPERATOR_PHONE) when set — publish failures, ad cap
 * breaches, etc. No-ops (returns false) when OPERATOR_PHONE is unset so local
 * / CI envs never throw. Does not create a brand Message row.
 */
export async function sendToOperator(
  body: string,
  opts?: { channel?: MessageChannel },
): Promise<boolean> {
  let phone: string | undefined;
  try {
    phone = getServerEnv().OPERATOR_PHONE;
  } catch {
    phone = process.env.OPERATOR_PHONE || undefined;
  }
  if (!phone) {
    console.warn("sendToOperator: OPERATOR_PHONE unset — skipping alert");
    return false;
  }
  const channel = opts?.channel ?? activeChannel();
  const text = sanitizeChatText(body);
  try {
    await withBackoff(() => channel.send({ to: phone!, body: text }), {
      onRetry: (err, attempt) => console.warn(`sendToOperator: send retry ${attempt}`, err),
    });
    return true;
  } catch (err) {
    console.error("sendToOperator: send failed after retries", err);
    return false;
  }
}

/**
 * Handle a normalised inbound message end-to-end: route to brand, persist,
 * capture media, and hand off to the orchestrator. Never throws —
 * an unknown sender or any internal failure is logged and results in a null
 * response rather than a crash.
 */
export type HandleInboundOpts = {
  channel?: MessageChannel;
  resolveBrand?: (from: string) => Promise<Brand | null>;
};

export async function handleInbound(
  inbound: InboundMessage,
  opts?: HandleInboundOpts,
): Promise<{ brandId: string | null; messageId: string | null }> {
  // Liveness from the first millisecond: keeper targets the sender address
  // directly (sender phone equals inbound.from), so it can start before brand
  // resolution. Twilio SMS no-ops here (paced sends + holding text below are
  // its stand-in). Never let typing break the pipeline.
  const channel = opts?.channel ?? activeChannel();
  const resolve = opts?.resolveBrand ?? resolveBrand;
  let keeper: TypingKeeper | null = null;
  try {
    try {
      keeper = startTypingKeeper(channel, inbound.from);
    } catch {
      keeper = null;
    }
    const brand = await resolve(inbound.from);
    if (!brand) {
      console.warn(`handleInbound: unknown sender ${inbound.from}, dropping inbound message`);
      return { brandId: null, messageId: null };
    }

    // Idempotency: a provider (Twilio/Linq retry) can redeliver the same message.
    // If we've already stored this provider id, skip — otherwise we'd draft,
    // generate, and reply twice.
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

    // Instant human ack so they never feel like they texted a void.
    // Photos get a specific styling ack; everything else gets a short reaction
    // to what they said. The orchestrator reply may also open with an ack —
    // stripLeadingAck drops that so we don't double-tap.
    const photoAckSent = newMedia.some((m) => m.kind === "photo");
    const inboundText = (inbound.body ?? "").trim();

    // If another inbound from this brand landed in the last few seconds, this
    // message is part of a burst — skip the extra ack (the first one already
    // covered it). The latest message in the burst will process the combined text.
    const priorInBurst = inboundText
      ? await queryOne<{ id: string }>(
          `select id from messages
           where brand_id = $1
             and direction = 'inbound'
             and id <> $2
             and created_at > now() - ($3::text || ' milliseconds')::interval
           order by created_at desc
           limit 1`,
          [brand.id, message.id, String(INBOUND_BURST_MS + 500)],
        )
      : null;

    let textAckSent = false;
    if (photoAckSent) {
      await sendToBrand(
        brand.id,
        "Got it — styling your photo and writing the caption now, one sec ✨",
        undefined,
        { pace: false, channel },
      ).catch(() => {});
    } else if (inboundText && !priorInBurst && shouldSendInstantTextAck(brand, inboundText)) {
      const ack = craftHumanAck(brand, inbound.body ?? "");
      if (ack) {
        await sendToBrand(brand.id, ack, undefined, { pace: false, channel }).catch(() => {});
        textAckSent = true;
      }
    }

    // Coalesce rapid SMS: wait briefly, then let only the latest message in the
    // burst run the orchestrator on the combined body (so "tips" + "and quotes"
    // become one turn instead of two racing replies).
    let messageForProcess = message;
    if (!photoAckSent && inboundText) {
      await sleep(INBOUND_BURST_MS);
      const latest = await queryOne<{ id: string }>(
          `select id from messages
           where brand_id = $1
             and direction = 'inbound'
             and created_at >= $2::timestamptz - ($3::text || ' milliseconds')::interval
           order by created_at desc
           limit 1`,
          [brand.id, message.created_at, String(INBOUND_BURST_MS + 500)],
        );
      if (latest && latest.id !== message.id) {
        // A newer inbound will handle the combined burst.
        return { brandId: brand.id, messageId: message.id };
      }
      const burst = await query<{ body: string | null }>(
        `select body from messages
         where brand_id = $1
           and direction = 'inbound'
           and created_at >= $2::timestamptz - ($3::text || ' milliseconds')::interval
         order by created_at asc`,
        [brand.id, message.created_at, String(INBOUND_BURST_MS + 500)],
      );
      const combined = burst
        .map((r) => (r.body ?? "").trim())
        .filter(Boolean)
        .join("\n");
      if (combined && combined !== inboundText) {
        messageForProcess = { ...message, body: combined };
      }
    }

    // Slow-work safety net for channels WITHOUT a native typing indicator
    // (plain SMS): if we're still thinking after a few seconds, say so.
    // Skipped when we already sent an instant ack, and when native typing
    // covers liveness.
    let slowTimer: ReturnType<typeof setTimeout> | null = null;
    try {
      if (!photoAckSent && !textAckSent && typeof channel.sendTyping !== "function") {
        slowTimer = setTimeout(() => {
          sendToBrand(brand.id, "Still on this — one sec…", undefined, { pace: false, channel }).catch(() => {});
        }, 4500);
        (slowTimer as unknown as { unref?: () => void }).unref?.();
      }
      const { reply, mediaUrl, finishOnboardingBrandId } = await processInbound({
        brand,
        message: messageForProcess,
        newMedia,
      });
      if (reply) {
        const toSend = textAckSent ? stripLeadingAck(reply) : reply;
        if (toSend) {
          await sendToBrand(brand.id, toSend, mediaUrl ? [mediaUrl] : undefined, { channel });
        } else if (mediaUrl) {
          await sendToBrand(brand.id, "", [mediaUrl], { channel });
        }
      }
      // Onboarding just completed: the ack is already with the owner. Now do
      // the slow compile and deliver the rundown as a second message.
      if (finishOnboardingBrandId) {
        const brandId = finishOnboardingBrandId;
        try {
          const rundown = await finishOnboarding(brandId);
          // Main voice recap first (no goodbye), then the plan afterthought as its own SMS.
          await sendToBrand(brandId, rundown.main, undefined, { channel, pace: false });
          await new Promise((r) => setTimeout(r, 900));
          await sendToBrand(brandId, rundown.afterthought, undefined, { channel, pace: false });

          // Kick the plan immediately so the concrete ETA is real — don't wait on the 30s worker tick.
          void (async () => {
            try {
              const sms = await buildOnboardingPlanSms(brandId);
              if (sms) {
                await sendToBrand(brandId, sms, undefined, { channel, pace: false });
                return;
              }
              // Research overran — nudge with another concrete ETA, worker will retry.
              await sendToBrand(brandId, planOverrunNudge(ONBOARDING_PLAN_ETA_MINUTES), undefined, {
                channel,
                pace: false,
              });
            } catch (err) {
              console.error(`handleInbound: onboarding plan follow-up failed for brand ${brandId}`, err);
            }
          })();
        } catch (err) {
          console.error(`handleInbound: finishOnboarding failed for brand ${brandId}`, err);
          await sendToBrand(
            brandId,
            "Hit a snag writing your voice up — your answers are safe though. I'll get the rundown to you shortly.",
            undefined,
            { channel },
          ).catch(() => {});
        }
      }
    } catch (err) {
      // Orchestrator failures must not lose the persisted inbound message — and
      // the client should never be left with silence.
      console.error(`handleInbound: processInbound failed for brand ${brand.id}, message ${message.id}`, err);
      try {
        await sendToBrand(brand.id, "Ah — that one glitched on my side. Mind sending it again?", undefined, { channel });
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
