import { query, queryOne, brandVoiceProfileSchema, publicMediaUrl } from "@pulse/shared";
import type { Brand, Message, MediaAsset, Post } from "@pulse/shared";
import { classifyInbound, type InboundClassification } from "./classify.js";
import { draftCaption } from "./draftCaption.js";
import { applyCorrection } from "./applyCorrection.js";
import { buildConversationContext } from "./conversationContext.js";
import { onboardingTurn } from "./onboarding.js";
import {
  editImageForBrand,
  messageWantsText,
  messageWantsImageEdit,
  generateHeadline,
  applyTextTile,
} from "./imaging.js";
import { ensurePillars, listPillars, classifyPhotoPillar, configurePillarsFromMessage } from "./pillars.js";
import { scheduleSlot } from "./scheduler.js";
import { generateFillerPost, recentlyPingedPillar } from "./fillers.js";
import { proposeCampaign, activateCampaign, getProposedCampaign } from "./campaigns.js";
import { updateFactsFromMessage, looksLikeBusinessFact } from "./businessProfile.js";
import { sendLatestDraft } from "./engagement.js";
import { repurposeUrl } from "./repurpose.js";
import { callLLM } from "./llm.js";

const URL_RE = /\bhttps?:\/\/\S+|\b[a-z0-9-]+\.(?:com|com\.au|co|net|org|io|app|shop|store)\b\S*/i;
const REPURPOSE_RE = /\b(repurpose|turn (my|this|the) (site|website|page|blog|menu)|make posts? (from|out of)|posts? from (my|this))\b/i;

const SEND_DRAFT_RE = /^\s*(send|post it|send it|send that)\b/i;

const DRAFT_FILLER_RE = /\b(draft|write|make|create)\s+(one|it|a\s+post|something)\b|\byou\s+(draft|write|make)\b/i;
const CAMPAIGN_RE = /\bcampaign\b|\blaunch\b|\b\d+\s*(?:day|week)s?\s+(?:push|sale|promo|campaign)\b|\brun a\b/i;
const CANCEL_RE = /^\s*(no|nah|cancel|scrap|forget it|don'?t)\b/i;

/** Format a scheduled slot like "Tue 7:00pm" in the process/brand timezone. */
function formatSlot(d: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

/** The most recent autopilot post still sitting in a future slot (for HOLD). */
async function getScheduledAutoPost(brandId: string): Promise<Post | null> {
  return queryOne<Post>(
    `select * from posts
      where brand_id = $1 and is_auto = true and status = 'scheduled'
        and (scheduled_at is null or scheduled_at > now())
      order by scheduled_at asc
      limit 1`,
    [brandId],
  );
}

const HOLD_RE = /^\s*(hold|stop|wait|pause|cancel|don'?t post)\b/i;

export type InboundContext = {
  brand: Brand;
  message: Message; // the freshly-persisted inbound row
  newMedia: MediaAsset[]; // media captured from this message
};

// Below this, we ask for clarification instead of guessing (BUILD_CONTRACTS.md:
// "Low confidence → reply asking to clarify, do NOT guess-and-act.").
const LOW_CONFIDENCE_THRESHOLD = 0.55;

/**
 * Classification maps 1:1 to the messages.type column, which now includes
 * 'edit' (see migration 0002_add_edit_message_type.sql).
 */
function toDbMessageType(c: InboundClassification): NonNullable<Message["type"]> {
  return c;
}

async function getLatestPendingPost(brandId: string): Promise<Post | null> {
  return queryOne<Post>(
    `select * from posts
     where brand_id = $1 and status = 'pending_approval'
     order by created_at desc
     limit 1`,
    [brandId],
  );
}

async function updateMessageType(messageId: string, type: NonNullable<Message["type"]>): Promise<void> {
  await query(`update messages set type = $1 where id = $2`, [type, messageId]);
}

async function reviseCaption(brand: Brand, currentCaption: string, instruction: string): Promise<string> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const system = [
    `You are revising a social media caption for "${brand.name}" per the client's instruction.`,
    "Output ONLY the revised caption text — no preamble, no surrounding quotes.",
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    profile.banned_words.length ? `Never use: ${profile.banned_words.join(", ")}.` : "",
    `Emoji policy: ${profile.emoji_policy}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const text = await callLLM({
    system,
    messages: [
      {
        role: "user",
        content: `Current caption:\n"""${currentCaption}"""\n\nClient's edit instruction:\n"""${instruction}"""\n\nRewrite the caption.`,
      },
    ],
    maxTokens: 400,
  });
  return text.trim();
}

async function answerQuestion(brand: Brand, context: string, question: string): Promise<string> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const system = [
    `You are Pulse, a helpful assistant texting on behalf of "${brand.name}"'s social media agency.`,
    "Answer the client's question briefly and helpfully, in a friendly SMS tone (a few sentences max).",
    profile.tone.length ? `Where relevant, match this brand's tone: ${profile.tone.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const text = await callLLM({
    system,
    messages: [
      { role: "user", content: `Conversation so far:\n${context}\n\nClient's question:\n${question}` },
    ],
    maxTokens: 300,
  });
  return text.trim();
}

/**
 * Decide + act on an inbound message. Frozen signature per
 * BUILD_CONTRACTS.md — called by @pulse/gateway's handleInbound after the
 * inbound message + media are persisted.
 */
export async function processInbound(
  ctx: InboundContext,
): Promise<{ reply: string; postId?: string; mediaUrl?: string }> {
  const { brand, message, newMedia } = ctx;

  // Mid-onboarding: run the setup conversation instead of the normal flow.
  if (brand.onboarding_state?.status === "in_progress") {
    const { reply } = await onboardingTurn(brand, message.body ?? "");
    return { reply };
  }

  // Hold-window kill switch: "HOLD" / "stop" pulls a scheduled autopilot post
  // back into a normal draft the client can approve or discard.
  if (message.body && HOLD_RE.test(message.body) && newMedia.length === 0) {
    const auto = await getScheduledAutoPost(brand.id);
    if (auto) {
      await query(`update posts set status = 'pending_approval', is_auto = false where id = $1`, [auto.id]);
      await query(
        `insert into approval_log (post_id, brand_id, action, actor, note)
         values ($1, $2, 'edited', $3, $4)`,
        [auto.id, brand.id, brand.approver, "Held by client via HOLD"],
      );
      return {
        reply: `Held — it won't go out. Reply "yes" to post it after all, or tell me what to change.`,
        postId: auto.id,
      };
    }
  }

  // A campaign proposal is awaiting the client's go-ahead: handle approve/cancel
  // before anything else (a plain "yes" here means "run the campaign").
  if (message.body && newMedia.length === 0) {
    const proposed = await getProposedCampaign(brand.id);
    if (proposed) {
      if (CANCEL_RE.test(message.body)) {
        await query(`update campaigns set status = 'cancelled' where id = $1`, [proposed.id]);
        return { reply: "No worries — I've scrapped that campaign. Nothing scheduled." };
      }
      const wantsPause = /\b(pause|hold|stop|just the campaign|only the campaign|instead)\b/i.test(message.body);
      const affirmed = /\b(yes|yep|yeah|go|run it|do it|approve|let'?s go|sounds good|blend|keep|alongside|pause)\b/i.test(message.body);
      if (affirmed) {
        const reply = await activateCampaign(brand, proposed, wantsPause);
        return { reply };
      }
      // Anything else while a campaign is pending: treat as a tweak to re-plan.
      const reproposed = await proposeCampaign(brand, message.body);
      if (reproposed) {
        await query(`update campaigns set status = 'cancelled' where id = $1`, [proposed.id]);
        return { reply: reproposed.summary, postId: undefined };
      }
    }
  }

  const pending = await getLatestPendingPost(brand.id);

  // "send" approves the most recent drafted reply to a customer interaction —
  // but only when there's no pending post (there, "send" would be ambiguous).
  if (message.body && SEND_DRAFT_RE.test(message.body) && newMedia.length === 0 && !pending) {
    const sent = await sendLatestDraft(brand);
    if (sent) return { reply: `Sent ✅\n\n"${sent}"` };
  }

  const result = await classifyInbound({
    body: message.body,
    hasMedia: newMedia.length > 0,
    hasPendingPost: pending !== null,
  });

  await updateMessageType(message.id, toDbMessageType(result.classification));

  if (result.confidence < LOW_CONFIDENCE_THRESHOLD) {
    return {
      reply:
        "Sorry, I'm not quite sure what you'd like me to do with that — could you clarify? " +
        "(Send a photo/video to draft a post, reply \"yes\" to approve, or tell me exactly what to change.)",
    };
  }

  switch (result.classification) {
    case "media": {
      const originalIds = newMedia.map((m) => m.id);
      const { caption, proposedTime } = await draftCaption(brand.id, originalIds);

      // Style the first photo (truthful enhance for business, bolder for personal).
      // If editing is unavailable, we fall back to the original photo.
      const firstPhoto = newMedia.find((m) => m.kind === "photo");
      let postMediaIds = originalIds;
      let styledUrl: string | undefined;
      const wantsText = messageWantsText(message.body);
      let headline: string | undefined;
      if (firstPhoto) {
        let finalId = firstPhoto.id;
        const editedId = await editImageForBrand(brand, firstPhoto.id, message.body ?? undefined);
        if (editedId) finalId = editedId;
        // If the client asked for text on the image, overlay a bold headline.
        if (wantsText) {
          headline = await generateHeadline(brand, caption);
          const tiledId = await applyTextTile(brand, finalId, headline);
          if (tiledId) finalId = tiledId;
        }
        if (finalId !== firstPhoto.id) {
          postMediaIds = [finalId, ...originalIds.filter((id) => id !== firstPhoto.id)];
          styledUrl = publicMediaUrl(finalId);
        }
      }

      // Sort the photo into a content pillar and find a smart slot for it.
      const pillars = await ensurePillars(brand.id);
      const firstMediaId = firstPhoto?.id ?? originalIds[0];
      const pillar = firstMediaId
        ? await classifyPhotoPillar(brand, pillars, firstMediaId)
        : pillars[0];
      const slot = await scheduleSlot({
        brandId: brand.id,
        platform: "instagram",
        pillarId: pillar?.id ?? null,
        postsPerWeek: pillar?.posts_per_week ?? 0,
      });
      const autopilot = Boolean(pillar?.autopilot);

      // Remember the source photo + styling recipe so a later "make the image
      // brighter" re-styles from the original instead of compounding edits.
      const styleMeta = { wants_text: wantsText, ...(headline ? { headline } : {}) };
      const post = await queryOne<Post>(
        `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at)
         values ($1, $2, $3::uuid[], $4::uuid[], $5::jsonb, $6, $7, $8, 'instagram', $9, $10)
         returning *`,
        [
          brand.id,
          caption,
          postMediaIds,
          originalIds,
          JSON.stringify(styleMeta),
          pillar?.id ?? null,
          autopilot,
          autopilot ? new Date().toISOString() : null,
          autopilot ? "scheduled" : "pending_approval",
          slot.toISOString(),
        ],
      );
      if (!post) throw new Error("Failed to insert post");

      await query(
        `insert into approval_log (post_id, brand_id, action, actor, after, note)
         values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
        [
          post.id,
          brand.id,
          JSON.stringify({ caption, scheduled_at: slot.toISOString(), pillar: pillar?.key, styled: Boolean(styledUrl) }),
          "Drafted from inbound media message",
        ],
      );

      // Autopilot: the pillar posts itself — no per-post approval. Give the client
      // the hold-window heads-up (the whole gap until the slot is their window).
      if (autopilot) {
        await query(
          `insert into approval_log (post_id, brand_id, action, actor, note)
           values ($1, $2, 'approved', 'system-autopilot', $3)`,
          [post.id, brand.id, "Auto-scheduled (pillar on autopilot)"],
        );
        const styledLine = styledUrl ? "Styled and scheduled ✨" : "Scheduled:";
        return {
          reply: `${styledLine}\n\n"${caption}"\n\n${pillar?.name} · going out ${formatSlot(slot)}. Reply "HOLD" to stop it, or tell me a change.`,
          postId: post.id,
          mediaUrl: styledUrl,
        };
      }

      const styledLine = styledUrl ? "Here's your post — I styled the photo too ✨" : "Here's your post:";
      return {
        reply: `${styledLine}\n\n"${caption}"\n\n${pillar?.name} · proposed for ${formatSlot(slot)}\n\nReply "yes" to approve, tell me what to change, or "no" to discard.`,
        postId: post.id,
        mediaUrl: styledUrl,
      };
    }

    case "edit": {
      if (!pending) {
        return {
          reply:
            "I don't have a pending draft to edit right now — send a photo or video and I'll draft a caption for it.",
        };
      }

      // A visual instruction ("make it brighter", "change the background") re-edits
      // the PHOTO — restyling from the original source, then re-applying the text
      // tile — rather than rewriting the caption.
      if (messageWantsImageEdit(message.body)) {
        const sourceId = pending.source_media_ids?.[0] ?? pending.media_ids[0];
        if (!sourceId) {
          return {
            reply: "I don't have the original photo to re-edit — send it again and I'll restyle it.",
            postId: pending.id,
          };
        }
        const editedId = await editImageForBrand(brand, sourceId, message.body ?? undefined);
        if (!editedId) {
          return {
            reply: "I couldn't re-edit the image just then — mind trying that again?",
            postId: pending.id,
          };
        }
        let finalId = editedId;
        const meta = pending.style_meta ?? {};
        if (meta.wants_text) {
          const headline = meta.headline ?? (await generateHeadline(brand, pending.caption ?? ""));
          const tiledId = await applyTextTile(brand, finalId, headline);
          if (tiledId) finalId = tiledId;
        }
        const newMediaIds = [finalId, ...pending.media_ids.slice(1)];
        await query(`update posts set media_ids = $1::uuid[] where id = $2 and brand_id = $3`, [
          newMediaIds,
          pending.id,
          brand.id,
        ]);
        await query(
          `insert into approval_log (post_id, brand_id, action, actor, note)
           values ($1, $2, 'edited', $3, $4)`,
          [pending.id, brand.id, brand.approver, "Re-edited image via inbound correction"],
        );
        return {
          reply: 'Here\'s the updated image ✨ — reply "yes" to approve, or tell me another change.',
          postId: pending.id,
          mediaUrl: publicMediaUrl(finalId),
        };
      }

      const before = pending.caption ?? "";
      const after = await reviseCaption(brand, before, message.body ?? "");

      // Records the correction + folds the delta into brand_voice_profile.notes.
      await applyCorrection(brand.id, pending.id, before, after);

      await query(
        `update posts set caption = $1 where id = $2 and brand_id = $3`,
        [after, pending.id, brand.id],
      );

      await query(
        `insert into approval_log (post_id, brand_id, action, actor, before, after, note)
         values ($1, $2, 'edited', $3, $4::jsonb, $5::jsonb, $6)`,
        [
          pending.id,
          brand.id,
          brand.approver,
          JSON.stringify({ caption: before }),
          JSON.stringify({ caption: after }),
          "Edited via inbound correction",
        ],
      );

      return {
        reply: `Updated:\n\n"${after}"\n\nReply "yes" to approve.`,
        postId: pending.id,
      };
    }

    case "approval": {
      if (!pending) {
        return { reply: "There's nothing pending approval right now." };
      }

      // Approval is absolute (BUILD_CONTRACTS.md): we may set 'approved', but
      // never 'publishing'/'published' — that stays the worker's job. "post now"
      // overrides the smart slot and publishes on the next tick.
      const postNow = /\b(now|immediately|right now|asap)\b/i.test(message.body ?? "");
      await query(
        `update posts set status = 'approved'${postNow ? ", scheduled_at = now()" : ""} where id = $1 and brand_id = $2`,
        [pending.id, brand.id],
      );

      await query(
        `insert into approval_log (post_id, brand_id, action, actor, note)
         values ($1, $2, 'approved', $3, $4)`,
        [pending.id, brand.id, brand.approver, "Approved via inbound message"],
      );

      const when = postNow
        ? " — going out now"
        : pending.scheduled_at
          ? ` — going out ${formatSlot(new Date(pending.scheduled_at))}`
          : "";
      return { reply: `Approved${when}.`, postId: pending.id };
    }

    case "question": {
      const context = await buildConversationContext(brand.id);
      const answer = await answerQuestion(brand, context, message.body ?? "");
      return { reply: answer };
    }

    case "instruction":
    case "other":
    default: {
      // "Repurpose my website" / a link with repurpose intent → atomise a page
      // into a batch of scheduled draft posts.
      if (message.body && REPURPOSE_RE.test(message.body)) {
        const url = message.body.match(URL_RE)?.[0];
        if (url) {
          const summary = await repurposeUrl(brand, url);
          return {
            reply:
              summary ??
              "I couldn't read that page — check the link's public and try again, or send me a photo instead.",
          };
        }
        return { reply: "Send me the link too and I'll turn it into a batch of posts." };
      }

      // Campaign request → propose a full plan for the client to approve.
      if (message.body && CAMPAIGN_RE.test(message.body)) {
        const proposal = await proposeCampaign(brand, message.body);
        if (proposal) return { reply: proposal.summary };
      }

      // "Draft one" (in reply to a gap-fill nudge) → generate a held filler post.
      if (message.body && DRAFT_FILLER_RE.test(message.body) && newMedia.length === 0) {
        const pillars = await ensurePillars(brand.id);
        const target = (await recentlyPingedPillar(brand.id)) ?? pillars[0];
        if (target) {
          const filler = await generateFillerPost(brand, target);
          if (filler) {
            return {
              reply: `Here's a ${target.name} post I drafted ✨\n\n"${filler.post.caption}"\n\nProposed for ${formatSlot(new Date(filler.post.scheduled_at!))}. Reply "yes" to approve, or tell me what to change.`,
              postId: filler.post.id,
              mediaUrl: filler.mediaUrl,
            };
          }
          return { reply: "I tried to draft one but hit a snag — mind asking again in a moment?" };
        }
      }

      // Business facts stated by the owner ("we're open till 6 now", "coffee's $5")
      // update the living profile the reply engine answers customers from.
      if (message.body && looksLikeBusinessFact(message.body)) {
        const factReply = await updateFactsFromMessage(brand, message.body);
        if (factReply) return { reply: factReply };
      }

      // A scheduling/cadence instruction ("put BTS on autopilot", "post promos
      // twice a week") reconfigures the client's pillars.
      if (message.body) {
        const pillars = await ensurePillars(brand.id);
        const configReply = await configurePillarsFromMessage(brand, pillars, message.body);
        if (configReply) return { reply: configReply };
      }
      return {
        reply:
          "Got it — noted. Send me a photo any time to draft a new post, or let me know specifically " +
          "what you'd like changed.",
      };
    }
  }
}
