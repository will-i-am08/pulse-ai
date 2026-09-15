import { randomUUID } from "node:crypto";
import {
  processInbound,
  finishOnboarding,
  craftHumanAck,
  stripLeadingAck,
  looksLikeAffirmation,
  looksLikePhotoBackgroundAsk,
  buildOnboardingPlanSms,
  planOverrunNudge,
  ONBOARDING_PLAN_ETA_MINUTES,
  refersToAttachedMedia,
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

/**
 * Extra wait when the owner says "with this photo" but this webhook has no media.
 * Carriers often deliver the MMS image as a second empty-body message a beat later.
 */
const PHOTO_ARRIVAL_WAIT_MS = 4500;
const PHOTO_ARRIVAL_POLL_MS = 700;

/** Re-export — single source of truth lives in @pulse/orchestrator. */
export { refersToAttachedMedia };

/** Owner asking how work-in-progress is going — answer directly, don't fake-wrap. */
export function looksLikeProgressCheck(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /^(are you )?(done|finished|ready)\b/i.test(t) ||
    /\b(done|finished|ready) yet\b/i.test(t) ||
    /\bstill (there|working|reading|going)\b/i.test(t) ||
    /\bhow(?:'?s| is| are)?\s+(?:it|things|everything)(?:\s+going)?\b/i.test(t) ||
    /\bhow(?:'?s| is)\s+(?:the\s+)?(?:progress|batch|draft|carousel|copy)\b/i.test(t) ||
    /\bany (?:update|luck|news|progress)\b/i.test(t) ||
    /\bwhat(?:'?s| is) (?:taking so long|happening|the (?:eta|status|update))\b/i.test(t) ||
    /^(?:update|status|progress)\??$/i.test(t)
  );
}

/**
 * Instant plain-text acks ("Makes sense, Bill." / "Got you, Bill.") are OFF.
 * They read as robotic one-liners before the real reply. Photo acks still fire
 * elsewhere; typing indicators + the actual reply cover liveness.
 */
export function shouldSendInstantTextAck(
  _brand: Pick<Brand, "onboarding_state">,
  _inboundText: string,
): boolean {
  return false;
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
 * Hard ceiling per outbound part. Twilio rejects a body over 1600 chars
 * outright (error 21617) and delivers nothing, so this is a last-resort floor
 * under splitIntoBubbles — not a formatting choice.
 */
export const MAX_SMS_PART_CHARS = 1500;

/** Chop any part that still exceeds the provider body limit. */
export function clampSmsParts(parts: string[], max = MAX_SMS_PART_CHARS): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part.length <= max) {
      out.push(part);
      continue;
    }
    for (let i = 0; i < part.length; i += max) out.push(part.slice(i, i + max));
  }
  return out;
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

      // Bytes FIRST, row second. storage_path is the row's own id, which is
      // also the putMedia key — so inserting the row before the blob exists
      // leaves a permanently-404ing orphan when putMedia fails (broken
      // dashboard thumbnails, Meta publishes that can't fetch image_url).
      // An orphan blob with no row is harmless by comparison.
      const mediaId = randomUUID();
      await withBackoff(() => putMedia(mediaId, bytes, contentType), {
        onRetry: (err, attempt) => console.warn(`captureMedia: putMedia retry ${attempt} for ${mediaId}`, err),
      });

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
  // Splitting is ALWAYS on. `pace` controls the typing pauses below, nothing
  // else: a long body handed to Twilio as one part is rejected with 21617 and
  // the client receives nothing at all (real content plans run ~2200 chars).
  // Never split captioned media — the text + image ride together as one MMS —
  // but still clamp it so an over-long caption can't sink the whole send.
  const hasMedia = !!mediaUrls && mediaUrls.length > 0;
  const parts = clampSmsParts(hasMedia ? [text] : splitIntoBubbles(text));

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
  /**
   * Schedule follow-up work that must outlive the HTTP response (the onboarding
   * plan SMS). On Vercel the isolate is frozen the moment the webhook returns
   * 204, so a bare `void (async () => ...)()` here silently never runs — the
   * same trap `scheduleKickoffDrain` documents. Serverless callers MUST pass
   * `defer: (task) => after(task)` from `next/server`; the gateway is
   * platform-agnostic and cannot import Next itself.
   *
   * Default reproduces the old detached behaviour so non-serverless callers
   * (worker, tests, lab) are unchanged.
   */
  defer?: (task: () => Promise<void>) => void;
};

/** What handleInbound managed to actually deliver back to the brand. */
export type HandleInboundResult = {
  brandId: string | null;
  messageId: string | null;
  /**
   * true = every reply we attempted reached the provider; false = at least one
   * reply failed after retries (the client may have gone dark and the operator
   * has been paged); null = we never attempted a reply for this inbound.
   */
  delivered: boolean | null;
};


async function loadMediaAssets(ids: string[]): Promise<MediaAsset[]> {
  if (ids.length === 0) return [];
  return query<MediaAsset>(
    `select * from media_assets where id = any($1::uuid[]) order by created_at asc`,
    [ids],
  );
}

/** Poll for a sibling inbound in the burst window that already captured media. */
async function waitForSiblingMedia(
  brandId: string,
  message: Message,
  budgetMs: number,
): Promise<MediaAsset[]> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(PHOTO_ARRIVAL_POLL_MS);
    const row = await queryOne<{ media_ids: string[] | null }>(
      `select media_ids from messages
       where brand_id = $1
         and direction = 'inbound'
         and id <> $2
         and created_at >= $3::timestamptz - ($4::text || ' milliseconds')::interval
         and coalesce(cardinality(media_ids), 0) > 0
       order by created_at desc
       limit 1`,
      [brandId, message.id, message.created_at, String(INBOUND_BURST_MS + budgetMs)],
    );
    const ids = row?.media_ids?.filter(Boolean) ?? [];
    if (ids.length > 0) return loadMediaAssets(ids);
  }
  return [];
}

export async function handleInbound(
  inbound: InboundMessage,
  opts?: HandleInboundOpts,
): Promise<HandleInboundResult> {
  // Liveness from the first millisecond: keeper targets the sender address
  // directly (sender phone equals inbound.from), so it can start before brand
  // resolution. Twilio SMS no-ops here (paced sends + holding text below are
  // its stand-in). Never let typing break the pipeline.
  const channel = opts?.channel ?? activeChannel();
  const resolve = opts?.resolveBrand ?? resolveBrand;
  const defer =
    opts?.defer ??
    ((task: () => Promise<void>) => {
      void task().catch((err) => console.error("handleInbound: deferred task failed", err));
    });
  let keeper: TypingKeeper | null = null;

  // sendToBrand returns false on silent failure (Twilio 21610 STOP / 21614 /
  // 21617 / 30007). Nothing used to check it, so a paying client could go
  // completely dark with only a console.error as evidence.
  let delivered: boolean | null = null;
  let operatorPaged = false;
  const deliver = async (
    toBrandId: string,
    body: string,
    mediaUrls?: string[],
    sendOpts?: { pace?: boolean },
  ): Promise<boolean> => {
    const ok = await sendToBrand(toBrandId, body, mediaUrls, { channel, ...sendOpts });
    delivered = delivered === false ? false : ok;
    if (!ok && !operatorPaged) {
      operatorPaged = true;
      await sendToOperator(
        `Kip: SMS to brand ${toBrandId} failed after retries — client may be receiving nothing. Check Twilio logs.`,
        { channel },
      ).catch(() => {});
    }
    return ok;
  };
  try {
    try {
      keeper = startTypingKeeper(channel, inbound.from);
    } catch {
      keeper = null;
    }
    const brand = await resolve(inbound.from);
    if (!brand) {
      console.warn(`handleInbound: unknown sender ${inbound.from}, dropping inbound message`);
      return { brandId: null, messageId: null, delivered: null };
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
        return { brandId: brand.id, messageId: seen.id, delivered: null };
      }
    }

    // Webhook sometimes arrives with NumMedia=0 even when Twilio has attachments —
    // recover via the Message Media subresource before we give up on the photo.
    let inboundMedia = inbound.media ?? [];
    if (
      inboundMedia.length === 0 &&
      inbound.providerMessageId &&
      typeof channel.listMessageMedia === "function"
    ) {
      try {
        const recovered = await channel.listMessageMedia(inbound.providerMessageId);
        if (recovered.length > 0) {
          console.warn(
            `handleInbound: recovered ${recovered.length} media via listMessageMedia for ${inbound.providerMessageId}`,
          );
          inboundMedia = recovered;
        }
      } catch (err) {
        console.warn(`handleInbound: listMessageMedia failed for ${inbound.providerMessageId}`, err);
      }
    }

    let newMedia = await captureMedia(brand.id, channel, inboundMedia);
    const mediaDownloadFailed = inboundMedia.length > 0 && newMedia.length === 0;

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
      return { brandId: brand.id, messageId: null, delivered: null };
    }

    // Instant human ack so they never feel like they texted a void.
    // Photos get a specific styling ack. Plain-text acks are only for
    // post-onboarding chat — during setup/interview the real reply already
    // reacts (or acknowledgeThenContinue embeds the ack), and a separate
    // "Makes sense, Bill" SMS before every turn feels robotic.
    // stripLeadingAck drops a leading ack from the orchestrator reply when we
    // already sent one, so we don't double-tap.
    let photoAckSent = newMedia.some((m) => m.kind === "photo");
    const inboundText = (inbound.body ?? "").trim();

    // If another inbound from this brand landed in the last few seconds, this
    // message is part of a burst — skip the extra ack (the first one already
    // covered it). The latest message in the burst will process the combined
    // text + media. This guard applies to MEDIA too: iOS dispatches three
    // photos as three separate MMS, which without it meant three identical
    // acks, three concurrent imaging jobs and three replies for one action.
    const priorInBurst = await queryOne<{ id: string }>(
      `select id from messages
       where brand_id = $1
         and direction = 'inbound'
         and id <> $2
         and created_at > now() - ($3::text || ' milliseconds')::interval
       order by created_at desc, id desc
       limit 1`,
      [brand.id, message.id, String(INBOUND_BURST_MS)],
    );

    let textAckSent = false;
    if (photoAckSent) {
      if (!priorInBurst) {
        await sendToBrand(
          brand.id,
          "Got it — styling your photo and writing the caption now, one sec ✨",
          undefined,
          { pace: false, channel },
        ).catch(() => {});
      }
    } else if (inboundText && !priorInBurst && shouldSendInstantTextAck(brand, inboundText)) {
      const ack = craftHumanAck(brand, inbound.body ?? "");
      if (ack) {
        await sendToBrand(brand.id, ack, undefined, { pace: false, channel }).catch(() => {});
        textAckSent = true;
      }
    }

    // Text said "with this photo" but media wasn't on this webhook — wait briefly
    // for a sibling MMS (empty-body image) before we tell them it never arrived.
    // In a text burst (retries), only the latest message should wait/reply.
    if (
      !newMedia.length &&
      !mediaDownloadFailed &&
      inboundText &&
      refersToAttachedMedia(inboundText)
    ) {
      await sleep(INBOUND_BURST_MS);
      const latestInBurst = await queryOne<{ id: string }>(
        `select id from messages
         where brand_id = $1
           and direction = 'inbound'
           and created_at >= $2::timestamptz - ($3::text || ' milliseconds')::interval
         order by created_at desc
         limit 1`,
        [brand.id, message.created_at, String(INBOUND_BURST_MS + 500)],
      );
      if (latestInBurst && latestInBurst.id !== message.id) {
        return { brandId: brand.id, messageId: message.id, delivered };
      }
      const siblingMedia = await waitForSiblingMedia(brand.id, message, PHOTO_ARRIVAL_WAIT_MS);
      if (siblingMedia.length > 0) {
        newMedia = siblingMedia;
        await query(`update messages set media_ids = $1::uuid[] where id = $2`, [
          newMedia.map((m) => m.id),
          message.id,
        ]).catch(() => {});
        message = { ...message, media_ids: newMedia.map((m) => m.id) };
        photoAckSent = true;
        await sendToBrand(
          brand.id,
          "Got it — styling your photo and writing the caption now, one sec ✨",
          undefined,
          { pace: false, channel },
        ).catch(() => {});
      }
      // No sibling — fall through to processInbound, which tries a recent banked
      // client photo then asks to resend if nothing is on file.
    }

    if (mediaDownloadFailed) {
      await sendToBrand(
        brand.id,
        "Got your text but I couldn't download the photo — mind sending the image one more time?",
        undefined,
        { pace: false, channel },
      ).catch(() => {});
      return { brandId: brand.id, messageId: message.id, delivered };
    }

    // Photo-only MMS (empty body) often arrives a beat before the caption text.
    // Wait the burst window; if a sibling text shows up, defer so that turn
    // owns the combined "photo + brief" instead of drafting a captionless post.
    if (photoAckSent && !inboundText) {
      await sleep(INBOUND_BURST_MS);
      const captionSibling = await queryOne<{ id: string }>(
        `select id from messages
         where brand_id = $1
           and direction = 'inbound'
           and id <> $2
           and created_at >= $3::timestamptz - ($4::text || ' milliseconds')::interval
           and coalesce(trim(body), '') <> ''
         order by created_at desc
         limit 1`,
        [brand.id, message.id, message.created_at, String(INBOUND_BURST_MS + 500)],
      );
      if (captionSibling) {
        return { brandId: brand.id, messageId: message.id, delivered };
      }
    }

    // Coalesce rapid SMS: wait briefly, then let only the latest message in the
    // burst run the orchestrator on the combined body (so "tips" + "and quotes"
    // become one turn instead of two racing replies).
    let messageForProcess = message;
    let mediaForProcess = newMedia;
    // Media participates too: iOS dispatches three photos as three separate
    // MMS, so a media-only burst must become ONE turn over three photos rather
    // than three turns (and three imaging jobs) against the same brand.
    if (inboundText || newMedia.length > 0) {
      // The lookback MUST equal the sleep. When it was longer (BURST_MS + 500)
      // a message landing in the 2800-3300ms seam was both already answered by
      // its own turn AND pulled into the next one, so the orchestrator
      // re-answered it — a confused double reply. `id desc` breaks ties on
      // identical created_at, so two simultaneous rows agree on one winner
      // instead of each deferring to the other and going silent.
      await sleep(INBOUND_BURST_MS);
      const latest = await queryOne<{ id: string }>(
          `select id from messages
           where brand_id = $1
             and direction = 'inbound'
             and created_at >= $2::timestamptz - ($3::text || ' milliseconds')::interval
           order by created_at desc, id desc
           limit 1`,
          [brand.id, message.created_at, String(INBOUND_BURST_MS)],
        );
      if (latest && latest.id !== message.id) {
        // A newer inbound will handle the combined burst.
        return { brandId: brand.id, messageId: message.id, delivered };
      }
      const burst = await query<{ body: string | null; media_ids: string[] | null }>(
        `select body, media_ids from messages
         where brand_id = $1
           and direction = 'inbound'
           and created_at >= $2::timestamptz - ($3::text || ' milliseconds')::interval
         order by created_at asc, id asc`,
        [brand.id, message.created_at, String(INBOUND_BURST_MS)],
      );
      const combined = burst
        .map((r) => (r.body ?? "").trim())
        .filter(Boolean)
        .join("\n");
      if (combined && combined !== inboundText) {
        messageForProcess = { ...message, body: combined };
      }
      const burstMediaIds = [
        ...new Set(
          burst.flatMap((r) => (Array.isArray(r.media_ids) ? r.media_ids : [])).filter(Boolean),
        ),
      ];
      if (burstMediaIds.length > 0) {
        const merged = await loadMediaAssets(burstMediaIds);
        if (merged.length > 0) {
          mediaForProcess = merged;
          await query(`update messages set media_ids = $1::uuid[] where id = $2`, [
            merged.map((m) => m.id),
            message.id,
          ]).catch(() => {});
          messageForProcess = {
            ...messageForProcess,
            media_ids: merged.map((m) => m.id),
          };
        }
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
      const { reply, mediaUrl, mediaUrls, finishOnboardingBrandId, operatorAlert } = await processInbound({
        brand,
        message: messageForProcess,
        newMedia: mediaForProcess,
      });
      if (reply) {
        const toSend = textAckSent ? stripLeadingAck(reply) : reply;
        const attach =
          mediaUrls && mediaUrls.length > 0 ? mediaUrls : mediaUrl ? [mediaUrl] : undefined;
        if (toSend) {
          // `deliver` wraps sendToBrand so a silent delivery failure is
          // detected and paged to the operator; `attach` carries every
          // carousel slide, not just the cover.
          await deliver(brand.id, toSend, attach);
        } else if (attach?.length) {
          await deliver(brand.id, "", attach);
        }
      }
      if (typeof operatorAlert === "string" && operatorAlert.trim()) {
        await sendToOperator(operatorAlert).catch((err) => {
          console.error(`handleInbound: operatorAlert failed for brand ${brand.id}`, err);
        });
      }
      // Onboarding just completed: the ack is already with the owner. Now do
      // the slow compile and deliver the rundown as a second message.
      if (finishOnboardingBrandId) {
        const brandId = finishOnboardingBrandId;
        try {
          const rundown = await finishOnboarding(brandId);
          // Main voice recap first (no goodbye), then the plan afterthought as its own SMS.
          await deliver(brandId, rundown.main, undefined, { pace: false });
          await new Promise((r) => setTimeout(r, 900));
          await deliver(brandId, rundown.afterthought, undefined, { pace: false });

          // Kick the plan immediately so the concrete ETA is real — don't wait on the 30s worker tick.
          // Routed through `defer` so serverless callers can keep the isolate
          // alive (Next's after()); a bare detached promise here was frozen on
          // webhook return and the plan SMS never went out.
          defer(async () => {
            try {
              const sms = await buildOnboardingPlanSms(brandId);
              if (sms) {
                await deliver(brandId, sms, undefined, { pace: false });
                return;
              }
              // Research overran — nudge with another concrete ETA, worker will retry.
              await deliver(brandId, planOverrunNudge(ONBOARDING_PLAN_ETA_MINUTES), undefined, {
                pace: false,
              });
            } catch (err) {
              console.error(`handleInbound: onboarding plan follow-up failed for brand ${brandId}`, err);
            }
          });
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
      // Kickoff drain runs via Next.js after() (scheduleKickoffDrain) + Railway
      // worker — not fire-and-forget here. Claiming in this void task raced the
      // webhook return and left kickoffs stuck in `running` forever.
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

    return { brandId: brand.id, messageId: message.id, delivered };
  } catch (err) {
    console.error("handleInbound: unexpected failure", err);
    return { brandId: null, messageId: null, delivered };
  } finally {
    keeper?.stop();
  }
}
