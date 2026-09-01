import { serviceClient, brandVoiceProfileSchema } from "@pulse/shared";
import type { Brand, Message, MediaAsset, Post } from "@pulse/shared";
import { classifyInbound, type InboundClassification } from "./classify.js";
import { draftCaption } from "./draftCaption.js";
import { applyCorrection } from "./applyCorrection.js";
import { buildConversationContext } from "./conversationContext.js";
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
  const db = serviceClient();
  const { data, error } = await db
    .from("posts")
    .select("*")
    .eq("brand_id", brandId)
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Post | null) ?? null;
}

async function updateMessageType(messageId: string, type: NonNullable<Message["type"]>): Promise<void> {
  const db = serviceClient();
  const { error } = await db.from("messages").update({ type }).eq("id", messageId);
  if (error) throw error;
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
): Promise<{ reply: string; postId?: string }> {
  const { brand, message, newMedia } = ctx;
  const db = serviceClient();

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
      const mediaIds = newMedia.map((m) => m.id);
      const { caption, proposedTime } = await draftCaption(brand.id, mediaIds);

      const { data: postRow, error: postErr } = await db
        .from("posts")
        .insert({
          brand_id: brand.id,
          caption,
          media_ids: mediaIds,
          platform: "instagram",
          status: "pending_approval",
          scheduled_at: proposedTime,
        })
        .select()
        .single();
      if (postErr || !postRow) throw postErr ?? new Error("Failed to insert post");
      const post = postRow as Post;

      const { error: logErr } = await db.from("approval_log").insert({
        post_id: post.id,
        brand_id: brand.id,
        action: "draft_created",
        actor: "system",
        after: { caption, proposed_time: proposedTime },
        note: "Drafted from inbound media message",
      });
      if (logErr) throw logErr;

      const timeLine = proposedTime ? `\nProposed time: ${proposedTime}` : "";
      return {
        reply: `Here's a draft caption:\n\n"${caption}"${timeLine}\n\nReply "yes" to approve, tell me what to change, or "no" to discard.`,
        postId: post.id,
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

      const { error: updateErr } = await db
        .from("posts")
        .update({ caption: after })
        .eq("id", pending.id)
        .eq("brand_id", brand.id);
      if (updateErr) throw updateErr;

      const { error: logErr } = await db.from("approval_log").insert({
        post_id: pending.id,
        brand_id: brand.id,
        action: "edited",
        actor: brand.approver,
        before: { caption: before },
        after: { caption: after },
        note: "Edited via inbound correction",
      });
      if (logErr) throw logErr;

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
      const { error: approveErr } = await db
        .from("posts")
        .update({ status: "approved" })
        .eq("id", pending.id)
        .eq("brand_id", brand.id);
      if (approveErr) throw approveErr;

      const { error: logErr } = await db.from("approval_log").insert({
        post_id: pending.id,
        brand_id: brand.id,
        action: "approved",
        actor: brand.approver,
        note: "Approved via inbound message",
      });
      if (logErr) throw logErr;

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
