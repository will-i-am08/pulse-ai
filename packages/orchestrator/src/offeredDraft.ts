/**
 * Offered-draft world model + mutation helpers for the general agent.
 * Caption and image text (overlay) are separate; tools mutate the pending post
 * without inventing a second router.
 */

import {
  query,
  queryOne,
  type Brand,
  type Post,
  brandVoiceProfileSchema,
} from "@pulse/shared";
import { applyCorrection } from "./applyCorrection.js";
import { persistEditedCaptions } from "./destinations.js";
import { applyTextTile, editImageForBrand, generateHeadline } from "./imaging.js";
import { callLLM } from "./llm.js";
import { previewUrlForPost } from "./mockup.js";

export type OfferedDraftView = {
  id: string;
  status: string;
  caption: string | null;
  format: string | null;
  platform: string | null;
  destinations: string[] | null;
  scheduled_at: string | null;
  media_ids: string[];
  source_media_ids: string[] | null;
  style_meta: Post["style_meta"];
  wants_text: boolean;
  headline: string | null;
  has_source: boolean;
  generated: boolean;
  photo_carousel: boolean;
};

/** Latest pending draft in front of the owner (last offered, then created). */
export async function loadOfferedDraft(brandId: string): Promise<Post | null> {
  return queryOne<Post>(
    `select * from posts
     where brand_id = $1 and status = 'pending_approval'
     order by coalesce(last_offered_at, created_at) desc, created_at desc
     limit 1`,
    [brandId],
  );
}

export function offeredDraftView(post: Post): OfferedDraftView {
  const meta = (post.style_meta ?? {}) as Record<string, unknown>;
  const wants =
    meta.wants_text === true ||
    (typeof meta.headline === "string" && meta.headline.trim().length > 0);
  const source = post.source_media_ids ?? [];
  return {
    id: post.id,
    status: post.status,
    caption: post.caption,
    format: post.format ?? null,
    platform: post.platform ?? null,
    destinations: post.destinations ?? null,
    scheduled_at: post.scheduled_at ?? null,
    media_ids: post.media_ids ?? [],
    source_media_ids: post.source_media_ids,
    style_meta: post.style_meta,
    wants_text: wants,
    headline: typeof meta.headline === "string" ? meta.headline : null,
    has_source: source.length > 0,
    generated: meta.generated === true,
    photo_carousel: meta.photo_carousel === true,
  };
}

function excerpt(text: string | null | undefined, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(empty)";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Plain-language block for retrieve / tool results.
 * Makes caption vs on-image text explicit so the agent can reason.
 */
export function formatOfferedDraftBlock(post: Post): string {
  const v = offeredDraftView(post);
  const lines: string[] = [
    `Offered draft id: ${v.id} (${v.status})`,
    `Caption (SMS / feed copy — separate from image text): ${excerpt(v.caption, 160)}`,
    `Format: ${v.format ?? "feed"} · platform: ${v.platform ?? "instagram"}`,
  ];
  if (v.destinations?.length) {
    lines.push(`Destinations: ${v.destinations.join(", ")}`);
  }
  if (v.scheduled_at) {
    lines.push(`Proposed time: ${v.scheduled_at}`);
  }
  if (v.wants_text) {
    lines.push(
      `Text on image: YES${v.headline ? ` (headline: ${v.headline})` : ""}. Caption ≠ image text — use set_image_text to change overlay.`,
    );
  } else {
    lines.push("Text on image: NO (clean photo / no overlay).");
  }
  lines.push(
    `Media: ${v.media_ids.length} styled id(s); clean source available: ${v.has_source ? "yes" : "no"}`,
  );
  if (v.generated) lines.push("Visual: AI/generated (not a client MMS attach).");
  if (v.photo_carousel) lines.push("Visual: photo carousel.");
  lines.push(
    "Owner 'yes' is handled outside tools (approval hard gate). Prefer set_image_text / revise_caption / restyle_image / regenerate_creative / reject_draft over guessing.",
  );
  return lines.join("\n");
}

/** True when an LLM caption rewrite is a clarifying question / refusal, not copy. */
export function looksLikeMetaCaption(text: string | null | undefined): boolean {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/\?\s*$/.test(t)) return true;
  if (
    /\b(i can'?t|i couldn'?t|could you|can you|what would you like|clarify|instead\??|tell me what|not sure what you mean|unable to)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(updated|sure|got it|okay|ok)[,:]?\s+/i.test(t) && t.length < 80) return true;
  return false;
}

/** True when a caption edit clearly missed shorter / drop-CTA. */
export function captionEditMissed(instruction: string, before: string, after: string): boolean {
  const t = instruction.toLowerCase();
  const prev = before.trim();
  const next = after.trim();
  if (!next) return false;
  if (/\b(shorter|shorten|trim it|cut (it |this )?down|fewer words|less wordy|tighter)\b/.test(t)) {
    if (next.length >= Math.floor(prev.length * 0.9)) return true;
  }
  if (
    /\b(drop|remove|no|without|skip)\b.{0,32}\b(cta|call to action|link|book now|dm|comment)\b/.test(t) ||
    /\b(no cta|drop the cta|remove the cta|no link|drop cta)\b/.test(t)
  ) {
    if (/\b(book now|link in bio|dm (me|us)|comment (below|link)|tap the link|link in our bio)\b/i.test(next)) {
      return true;
    }
  }
  return false;
}

/** True when the owner is asking to strip/change image overlay, not feed caption. */
export function instructionLooksLikeOverlayStrip(instruction: string | null | undefined): boolean {
  const t = (instruction ?? "").trim();
  if (!t) return false;
  if (/\b(caption|feed copy|under (the )?(post|photo)|post copy)\b/i.test(t) && !/\b(image|photo|pic|overlay)\b/i.test(t)) {
    return false;
  }
  if (
    /\b(remove|strip|drop|delete|take off|clear)\b.{0,28}\b(text|words|headline|overlay|writing)\b/i.test(t)
  ) {
    return true;
  }
  if (/\b(no text|without text|text off)\b.{0,24}\b(on|from)\s+(the\s+)?(image|photo|pic|picture|overlay)\b/i.test(t)) {
    return true;
  }
  if (/^(no text|without text|text off|remove the text)\s*[!.?]*$/i.test(t)) return true;
  return false;
}

export async function reviseOfferedCaption(
  brand: Brand,
  currentCaption: string,
  instruction: string,
): Promise<{ ok: true; caption: string } | { ok: false; error: string }> {
  if (instructionLooksLikeOverlayStrip(instruction)) {
    return {
      ok: false,
      error: "Instruction looks like image-overlay removal — use set_image_text instead.",
    };
  }
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const system = [
    `You are revising a social media caption for "${brand.name}" per the client's instruction.`,
    "Output ONLY the revised caption text, no preamble, no surrounding quotes.",
    "The instruction is about the CAPTION (feed copy), not text burned onto the image. If they asked to remove image/overlay text, say so is out of scope by outputting exactly: OVERLAY_NOT_CAPTION",
    "Treat the instruction as a rewrite. If they name a different subject, drop the old one. If they say shorter, the result MUST be fewer words than the current caption. If they say drop/remove/no CTA, delete the call-to-action line entirely. Never glue the new ask onto the old caption. Never return the same caption. Never ask the owner a clarifying question — output only caption copy.",
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    profile.banned_words.length ? `Never use: ${profile.banned_words.join(", ")}.` : "",
    `Emoji policy: ${profile.emoji_policy}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const run = (extra: string) =>
    callLLM({
      system,
      messages: [
        {
          role: "user",
          content: `Current caption:\n"""${currentCaption}"""\n\nClient's edit instruction:\n"""${instruction}"""\n\n${extra}`,
        },
      ],
      maxTokens: 400,
      tier: "standard",
      task: "revise_caption",
    });

  let text = (await run("Rewrite the caption.")).trim();
  if (/^OVERLAY_NOT_CAPTION\b/i.test(text)) {
    return {
      ok: false,
      error: "Instruction looks like image-overlay removal — use set_image_text instead.",
    };
  }
  if (captionEditMissed(instruction, currentCaption, text) || looksLikeMetaCaption(text)) {
    text = (
      await run(
        "The last rewrite was wrong. Output ONLY the revised caption. No questions. Shorter means fewer words. Drop CTA means no book/link/DM line.",
      )
    ).trim();
  }
  if (/^OVERLAY_NOT_CAPTION\b/i.test(text) || looksLikeMetaCaption(text)) {
    return { ok: false, error: "Caption rewrite looked like a clarifying question — not applied." };
  }
  return { ok: true, caption: text };
}

export type DraftMutationResult = {
  ok: boolean;
  postId?: string;
  captionExcerpt?: string;
  mediaUrl?: string | null;
  wants_text?: boolean;
  headline?: string | null;
  error?: string;
  ackSms?: string;
  note?: string;
};

async function reloadPost(brandId: string, postId: string): Promise<Post | null> {
  return queryOne<Post>(`select * from posts where id = $1 and brand_id = $2`, [postId, brandId]);
}

/** Restore clean source media and clear overlay flags. Caption unchanged. */
export async function clearImageOverlay(brand: Brand, post: Post): Promise<DraftMutationResult> {
  const sourceId = post.source_media_ids?.[0];
  if (!sourceId) {
    return {
      ok: false,
      postId: post.id,
      error: "No clean source media on this draft — cannot strip overlay without re-generating.",
    };
  }
  const meta = { ...(post.style_meta ?? {}) } as Record<string, unknown>;
  delete meta.headline;
  meta.wants_text = false;
  const newMediaIds = [sourceId, ...(post.media_ids ?? []).slice(1)];
  await query(
    `update posts set media_ids = $1::uuid[], style_meta = $2::jsonb, updated_at = now()
     where id = $3 and brand_id = $4`,
    [newMediaIds, JSON.stringify(meta), post.id, brand.id],
  );
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, note)
     values ($1, $2, 'edited', $3, $4)`,
    [post.id, brand.id, brand.approver, "Cleared image overlay via agent tool"],
  ).catch(() => {});
  const updated = (await reloadPost(brand.id, post.id)) ?? post;
  const mediaUrl = await previewUrlForPost(
    brand,
    { caption: updated.caption, format: updated.format, media_ids: newMediaIds },
    sourceId,
  ).catch(() => null);
  return {
    ok: true,
    postId: post.id,
    captionExcerpt: excerpt(updated.caption, 120),
    mediaUrl,
    wants_text: false,
    headline: null,
    ackSms: "Took the text off the image. Caption unchanged. Reply yes to send it, or tell me another change.",
    note: "Overlay cleared from source media. Caption not modified.",
  };
}

/** Burn (or re-burn) a headline tile onto the draft image. */
export async function setImageOverlay(
  brand: Brand,
  post: Post,
  headline?: string | null,
): Promise<DraftMutationResult> {
  const sourceId = post.source_media_ids?.[0] ?? post.media_ids?.[0];
  if (!sourceId) {
    return { ok: false, postId: post.id, error: "No media on this draft to overlay." };
  }
  let hl = (headline ?? "").trim();
  if (!hl) {
    const metaHl = (post.style_meta as { headline?: string } | null)?.headline;
    hl = (metaHl ?? "").trim() || (await generateHeadline(brand, post.caption ?? ""));
  }
  const tiledId = await applyTextTile(brand, sourceId, hl);
  if (!tiledId) {
    return { ok: false, postId: post.id, error: "Could not apply text tile." };
  }
  const meta = { ...(post.style_meta ?? {}), wants_text: true, headline: hl };
  const newMediaIds = [tiledId, ...(post.media_ids ?? []).slice(1)];
  await query(
    `update posts set media_ids = $1::uuid[], style_meta = $2::jsonb, updated_at = now()
     where id = $3 and brand_id = $4`,
    [newMediaIds, JSON.stringify(meta), post.id, brand.id],
  );
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, note)
     values ($1, $2, 'edited', $3, $4)`,
    [post.id, brand.id, brand.approver, "Set image overlay via agent tool"],
  ).catch(() => {});
  const mediaUrl = await previewUrlForPost(
    brand,
    { caption: post.caption, format: post.format, media_ids: newMediaIds },
    tiledId,
  ).catch(() => null);
  return {
    ok: true,
    postId: post.id,
    captionExcerpt: excerpt(post.caption, 120),
    mediaUrl,
    wants_text: true,
    headline: hl,
    ackSms: "Updated the text on the image. Reply yes to send it, or tell me another change.",
    note: "Overlay applied. Caption unchanged.",
  };
}

export async function restyleOfferedImage(
  brand: Brand,
  post: Post,
  instruction: string,
): Promise<DraftMutationResult> {
  const sourceId = post.source_media_ids?.[0] ?? post.media_ids?.[0];
  if (!sourceId) {
    return { ok: false, postId: post.id, error: "No media to restyle." };
  }
  const editedId = await editImageForBrand(brand, sourceId, instruction);
  if (!editedId) {
    return { ok: false, postId: post.id, error: "Image restyle failed or is unavailable." };
  }
  let finalId = editedId;
  const meta = { ...(post.style_meta ?? {}) } as Record<string, unknown>;
  const wants = meta.wants_text === true;
  if (wants) {
    const headline =
      (typeof meta.headline === "string" && meta.headline) ||
      (await generateHeadline(brand, post.caption ?? ""));
    const tiledId = await applyTextTile(brand, finalId, headline);
    if (tiledId) {
      finalId = tiledId;
      meta.headline = headline;
      meta.wants_text = true;
    }
  }
  const newMediaIds = [finalId, ...(post.media_ids ?? []).slice(1)];
  await query(
    `update posts set media_ids = $1::uuid[], style_meta = $2::jsonb, updated_at = now()
     where id = $3 and brand_id = $4`,
    [newMediaIds, JSON.stringify(meta), post.id, brand.id],
  );
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, note)
     values ($1, $2, 'edited', $3, $4)`,
    [post.id, brand.id, brand.approver, "Restyled image via agent tool"],
  ).catch(() => {});
  const mediaUrl = await previewUrlForPost(
    brand,
    { caption: post.caption, format: post.format, media_ids: newMediaIds },
    finalId,
  ).catch(() => null);
  return {
    ok: true,
    postId: post.id,
    captionExcerpt: excerpt(post.caption, 120),
    mediaUrl,
    wants_text: Boolean(meta.wants_text),
    headline: typeof meta.headline === "string" ? meta.headline : null,
    ackSms: "Here's the updated image. Reply yes to send it, or tell me another change.",
    note: "Image restyled from source; overlay re-applied only if wants_text was already true.",
  };
}

export async function reviseOfferedDraftCaption(
  brand: Brand,
  post: Post,
  instruction: string,
): Promise<DraftMutationResult> {
  const before = post.caption ?? "";
  const revised = await reviseOfferedCaption(brand, before, instruction);
  if (!revised.ok) {
    return { ok: false, postId: post.id, error: revised.error };
  }
  await applyCorrection(brand.id, post.id, before, revised.caption);
  await persistEditedCaptions(post, revised.caption);
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, before, after, note)
     values ($1, $2, 'edited', $3, $4::jsonb, $5::jsonb, $6)`,
    [
      post.id,
      brand.id,
      brand.approver,
      JSON.stringify({ caption: before }),
      JSON.stringify({ caption: revised.caption }),
      "Edited caption via agent tool",
    ],
  ).catch(() => {});

  let mediaUrl: string | null = null;
  const displayId = post.media_ids?.[0];
  if (displayId) {
    mediaUrl = await previewUrlForPost(
      brand,
      { caption: revised.caption, format: post.format, media_ids: post.media_ids },
      displayId,
    ).catch(() => null);
  }
  return {
    ok: true,
    postId: post.id,
    captionExcerpt: excerpt(revised.caption, 120),
    mediaUrl,
    wants_text: offeredDraftView(post).wants_text,
    headline: offeredDraftView(post).headline,
    ackSms: `Updated:\n\n${revised.caption}\n\nReply yes to send it.`,
    note: "Caption revised. Image overlay unchanged.",
  };
}

export async function rejectOfferedDraft(brand: Brand, post: Post, note?: string): Promise<DraftMutationResult> {
  await query(
    `update posts set status = 'rejected', updated_at = now() where id = $1 and brand_id = $2`,
    [post.id, brand.id],
  );
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, note)
     values ($1, $2, 'rejected', $3, $4)`,
    [post.id, brand.id, brand.approver, note?.trim() || "Rejected via agent tool"],
  ).catch(() => {});
  return {
    ok: true,
    postId: post.id,
    ackSms: "Scrapped that draft. Tell me what to make next.",
    note: "Draft rejected. Nothing published.",
  };
}
