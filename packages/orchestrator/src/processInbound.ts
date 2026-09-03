import { query, queryOne, brandVoiceProfileSchema, publicMediaUrl } from "@pulse/shared";
import type { Brand, Message, MediaAsset, Post } from "@pulse/shared";
import { classifyInbound, type InboundClassification } from "./classify.js";
import { draftCaption } from "./draftCaption.js";
import { applyCorrection } from "./applyCorrection.js";
import { buildConversationContext } from "./conversationContext.js";
import { onboardingTurn } from "./onboarding.js";
import { editImageForBrand, messageWantsText, generateHeadline, applyTextTile } from "./imaging.js";
import { callLLM } from "./llm.js";

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

  const pending = await getLatestPendingPost(brand.id);

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
      if (firstPhoto) {
        let finalId = firstPhoto.id;
        const editedId = await editImageForBrand(brand, firstPhoto.id, message.body ?? undefined);
        if (editedId) finalId = editedId;
        // If the client asked for text on the image, overlay a bold headline.
        if (messageWantsText(message.body)) {
          const headline = await generateHeadline(brand, caption);
          const tiledId = await applyTextTile(brand, finalId, headline);
          if (tiledId) finalId = tiledId;
        }
        if (finalId !== firstPhoto.id) {
          postMediaIds = [finalId, ...originalIds.filter((id) => id !== firstPhoto.id)];
          styledUrl = publicMediaUrl(finalId);
        }
      }

      const post = await queryOne<Post>(
        `insert into posts (brand_id, caption, media_ids, platform, status, scheduled_at)
         values ($1, $2, $3::uuid[], 'instagram', 'pending_approval', $4)
         returning *`,
        [brand.id, caption, postMediaIds, proposedTime],
      );
      if (!post) throw new Error("Failed to insert post");

      await query(
        `insert into approval_log (post_id, brand_id, action, actor, after, note)
         values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
        [
          post.id,
          brand.id,
          JSON.stringify({ caption, proposed_time: proposedTime, styled: Boolean(styledUrl) }),
          "Drafted from inbound media message",
        ],
      );

      const timeLine = proposedTime ? `\nProposed time: ${proposedTime}` : "";
      const styledLine = styledUrl ? "Here's your post — I styled the photo too ✨" : "Here's your post:";
      return {
        reply: `${styledLine}\n\n"${caption}"${timeLine}\n\nReply "yes" to approve, tell me what to change, or "no" to discard.`,
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
      // never 'publishing'/'published' — that stays the worker's job.
      await query(
        `update posts set status = 'approved' where id = $1 and brand_id = $2`,
        [pending.id, brand.id],
      );

      await query(
        `insert into approval_log (post_id, brand_id, action, actor, note)
         values ($1, $2, 'approved', $3, $4)`,
        [pending.id, brand.id, brand.approver, "Approved via inbound message"],
      );

      return { reply: "Approved — this'll go out at the scheduled time.", postId: pending.id };
    }

    case "question": {
      const context = await buildConversationContext(brand.id);
      const answer = await answerQuestion(brand, context, message.body ?? "");
      return { reply: answer };
    }

    case "instruction":
    case "other":
    default: {
      return {
        reply:
          "Got it — noted. Send me a photo any time to draft a new post, or let me know specifically " +
          "what you'd like changed.",
      };
    }
  }
}
