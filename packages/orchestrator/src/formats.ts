import { randomUUID } from "node:crypto";
import {
  query,
  queryOne,
  putMedia,
  brandVoiceProfileSchema,
  sanitizeChatText,
  type Brand,
  type Pillar,
  type Post,
  type PostFormat,
} from "@pulse/shared";
import { draftCaption } from "./draftCaption.js";
import { editImageForBrand, renderQuoteCard } from "./imaging.js";
import { previewUrlForPost } from "./mockup.js";
import { scheduleSlot } from "./scheduler.js";
import { ensurePillars, classifyPhotoPillar } from "./pillars.js";
import { callLLM } from "./llm.js";

// Post-format handling. When several photos arrive at once we don't guess — we
// park them as a holding 'draft' carousel and ask "carousel or separate?", then
// resolve on the client's answer.

const CAROUSEL_YES = /\b(carousel|one post|together|swipe|swipeable|bundle|all in one|combined?|as one)\b/i;
const SEPARATE_YES = /\b(separate|separately|individual|split|apart|each|different posts?|on their own|one by one)\b/i;

/** Read a carousel-vs-separate answer from the client's reply. */
export function carouselDecision(body: string): "carousel" | "separate" | null {
  if (SEPARATE_YES.test(body)) return "separate";
  if (CAROUSEL_YES.test(body)) return "carousel";
  return null;
}

/** The holding 'draft' carousel awaiting a carousel-or-separate answer, if any. */
export async function getPendingCarouselChoice(brandId: string): Promise<Post | null> {
  return queryOne<Post>(
    `select * from posts
      where brand_id = $1 and status = 'draft' and format = 'carousel'
        and created_at > now() - interval '30 minutes'
      order by created_at desc
      limit 1`,
    [brandId],
  );
}

/** Park several photos as a holding carousel draft until the client decides. */
export async function parkCarouselChoice(brandId: string, photoIds: string[]): Promise<void> {
  await query(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, format, platform, status)
     values ($1, null, $2::uuid[], $2::uuid[], 'carousel', 'instagram', 'draft')`,
    [brandId, photoIds],
  );
}

async function scheduleFor(brand: Brand, pillarId: string | null, postsPerWeek: number): Promise<Date> {
  return scheduleSlot({ brandId: brand.id, platform: "instagram", pillarId, postsPerWeek });
}

/** Turn the parked photos into ONE carousel post (styling the cover). */
export async function resolveAsCarousel(brand: Brand, draft: Post): Promise<{ post: Post; mediaUrl: string | null } | null> {
  const ids = draft.source_media_ids ?? draft.media_ids;
  if (ids.length === 0) return null;
  const { caption } = await draftCaption(brand.id, ids);

  // Style the cover (first slide) only; the rest ride as-is.
  let coverId = ids[0]!;
  const edited = await editImageForBrand(brand, coverId).catch(() => null);
  if (edited) coverId = edited;
  const mediaIds = coverId !== ids[0] ? [coverId, ...ids.slice(1)] : ids;

  const pillars = await ensurePillars(brand.id);
  const pillar = await classifyPhotoPillar(brand, pillars, ids[0]!);
  const autopilot = Boolean(pillar?.autopilot);
  const slot = await scheduleFor(brand, pillar?.id ?? null, pillar?.posts_per_week ?? 0);

  const post = await queryOne<Post>(
    `update posts set caption = $1, media_ids = $2::uuid[], pillar_id = $3, is_auto = $4,
        hold_notified_at = $5, status = $6, scheduled_at = $7
      where id = $8 returning *`,
    [
      caption,
      mediaIds,
      pillar?.id ?? null,
      autopilot,
      autopilot ? new Date().toISOString() : null,
      autopilot ? "scheduled" : "pending_approval",
      slot.toISOString(),
      draft.id,
    ],
  );
  if (!post) return null;
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [post.id, brand.id, JSON.stringify({ caption, format: "carousel", slides: mediaIds.length }), "Carousel drafted from multiple photos"],
  ).catch(() => {});
  return { post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!) };
}

// ─── Format variety ─────────────────────────────────────────────────────────

/**
 * Pick the next format to keep the feed varied, biased toward carousels (best
 * saves/reach). Avoids repeating the most-recent format so the week mixes up.
 */
export async function chooseNextFormat(brandId: string): Promise<PostFormat> {
  const recent = await query<{ format: PostFormat }>(
    `select format from posts
      where brand_id = $1 and status in ('pending_approval','approved','scheduled','published')
      order by created_at desc limit 5`,
    [brandId],
  );
  const last = recent[0]?.format;
  // Carousel-leaning weights.
  const weights: Array<[PostFormat, number]> = [
    ["carousel", 5],
    ["feed", 3],
    ["story", 2],
  ];
  const pool = weights.filter(([f]) => f !== last); // never immediately repeat
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [f, w] of pool) {
    r -= w;
    if (r <= 0) return f;
  }
  return "carousel";
}

/**
 * Judge whether story content is a casual candid (safe to auto-post) or salesy —
 * a claim, price, offer or promo — which must wait for the owner's yes.
 */
export async function classifyStoryTone(brand: Brand, text: string): Promise<"candid" | "salesy"> {
  if (!text.trim()) return "candid";
  try {
    const verdict = await callLLM({
      system: [
        `Classifying a Story for "${brand.name}". Is it a casual, behind-the-scenes CANDID, or SALESY (a price, discount, offer, guarantee, or a factual claim/promotion)?`,
        'Answer with exactly one word: "candid" or "salesy". When unsure, answer "salesy".',
      ].join("\n"),
      messages: [{ role: "user", content: text.slice(0, 500) }],
      maxTokens: 5,
    });
    return /salesy/i.test(verdict) ? "salesy" : "candid";
  } catch {
    return "salesy"; // fail safe — gate it
  }
}

/**
 * Generate an AI tip/value CAROUSEL: an LLM writes a hook + a few tip slides, each
 * rendered as a branded card. Lands pending_approval (generated value content is
 * always approved, never auto). Returns the post + cover url, or null.
 */
export async function generateTipCarousel(
  brand: Brand,
  pillar: Pillar,
): Promise<{ post: Post; mediaUrl: string } | null> {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const system = [
    `You write a value-packed tip CAROUSEL for "${brand.name}" in the "${pillar.name}" pillar (${pillar.description}).`,
    profile.tone.length ? `Tone: ${profile.tone.join(", ")}.` : "",
    'Output ONLY JSON: {"caption":"<the post caption>","slides":["<hook line>","<tip 1>","<tip 2>","<tip 3>","<CTA line>"]}',
    "3 to 5 slides. Each slide is ONE short punchy line (max about 10 words) that reads big on a card. No numbering, no emoji, no quotes, no dashes of any kind.",
  ]
    .filter(Boolean)
    .join("\n");

  let caption: string;
  let slides: string[];
  try {
    const raw = await callLLM({ system, messages: [{ role: "user", content: `Write today's ${pillar.name} tip carousel.` }], maxTokens: 400 });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    caption = sanitizeChatText(String(parsed.caption ?? ""));
    slides = Array.isArray(parsed.slides) ? parsed.slides.map((s: unknown) => sanitizeChatText(String(s))).filter(Boolean).slice(0, 8) : [];
    if (!caption || slides.length < 2) return null;
  } catch (err) {
    console.error("generateTipCarousel: LLM/parse failed", err);
    return null;
  }

  const mediaIds: string[] = [];
  try {
    for (const slide of slides) {
      const id = randomUUID();
      const img = await renderQuoteCard(slide, brand.name);
      await query(
        `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
         values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
        [id, brand.id, id],
      );
      await putMedia(id, new Uint8Array(img), "image/jpeg");
      mediaIds.push(id);
    }
  } catch (err) {
    console.error("generateTipCarousel: render/store failed", err);
    return null;
  }

  const slot = await scheduleFor(brand, pillar.id, pillar.posts_per_week);
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, format, pillar_id, is_auto, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], 'carousel', $4, false, 'instagram', 'pending_approval', $5)
     returning *`,
    [brand.id, caption, mediaIds, pillar.id, slot.toISOString()],
  );
  if (!post) return null;
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [post.id, brand.id, JSON.stringify({ caption, format: "carousel", slides: mediaIds.length }), "AI tip carousel"],
  ).catch(() => {});
  return { post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!) };
}

/** Draft a carousel from specific library photos (bot-assembled). Cover styled. */
export async function draftCarouselFromPhotos(
  brand: Brand,
  photoIds: string[],
  pillar: Pillar,
): Promise<{ post: Post; mediaUrl: string | null } | null> {
  if (photoIds.length < 2) return null;
  const { caption } = await draftCaption(brand.id, photoIds);
  let coverId = photoIds[0]!;
  const edited = await editImageForBrand(brand, coverId).catch(() => null);
  if (edited) coverId = edited;
  const mediaIds = coverId !== photoIds[0] ? [coverId, ...photoIds.slice(1)] : photoIds;
  const autopilot = Boolean(pillar.autopilot);
  const slot = await scheduleFor(brand, pillar.id, pillar.posts_per_week);
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, format, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4::uuid[], 'carousel', $5, $6, $7, 'instagram', $8, $9)
     returning *`,
    [
      brand.id,
      caption,
      mediaIds,
      photoIds,
      pillar.id,
      autopilot,
      autopilot ? new Date().toISOString() : null,
      autopilot ? "scheduled" : "pending_approval",
      slot.toISOString(),
    ],
  );
  if (!post) return null;
  if (autopilot) {
    await query(
      `insert into approval_log (post_id, brand_id, action, actor, note) values ($1, $2, 'approved', 'system-autopilot', $3)`,
      [post.id, brand.id, "Auto-scheduled carousel from library"],
    ).catch(() => {});
  }
  return { post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!) };
}

/**
 * Draft a STORY from one photo. A candid auto-posts (like autopilot); anything
 * salesy waits for the owner's yes. Returns whether it auto-posted.
 */
export async function draftStoryFromPhoto(
  brand: Brand,
  photo: { id: string },
  pillar: Pillar,
): Promise<{ post: Post; mediaUrl: string | null; auto: boolean } | null> {
  const { caption } = await draftCaption(brand.id, [photo.id]);
  const tone = await classifyStoryTone(brand, caption);
  const auto = tone === "candid";
  let coverId = photo.id;
  const edited = await editImageForBrand(brand, photo.id).catch(() => null);
  if (edited) coverId = edited;
  const mediaIds = coverId !== photo.id ? [coverId] : [photo.id];
  const slot = await scheduleFor(brand, pillar.id, pillar.posts_per_week);
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, format, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4::uuid[], 'story', $5, $6, $7, 'instagram', $8, $9)
     returning *`,
    [
      brand.id,
      caption,
      mediaIds,
      [photo.id],
      pillar.id,
      auto,
      auto ? new Date().toISOString() : null,
      auto ? "scheduled" : "pending_approval",
      slot.toISOString(),
    ],
  );
  if (!post) return null;
  if (auto) {
    await query(
      `insert into approval_log (post_id, brand_id, action, actor, note) values ($1, $2, 'approved', 'system-autopilot', $3)`,
      [post.id, brand.id, "Auto-posted candid story"],
    ).catch(() => {});
  }
  return { post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!), auto };
}

/** Turn the parked photos into SEPARATE feed posts; drop the holding draft. */
export async function resolveAsSeparate(brand: Brand, draft: Post): Promise<number> {
  const ids = draft.source_media_ids ?? draft.media_ids;
  const pillars = await ensurePillars(brand.id);
  let made = 0;
  for (const id of ids) {
    try {
      const { caption } = await draftCaption(brand.id, [id]);
      let finalId = id;
      const edited = await editImageForBrand(brand, id).catch(() => null);
      if (edited) finalId = edited;
      const pillar = await classifyPhotoPillar(brand, pillars, id);
      const autopilot = Boolean(pillar?.autopilot);
      const slot = await scheduleFor(brand, pillar?.id ?? null, pillar?.posts_per_week ?? 0);
      await query(
        `insert into posts (brand_id, caption, media_ids, source_media_ids, format, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at)
         values ($1, $2, $3::uuid[], $4::uuid[], 'feed', $5, $6, $7, 'instagram', $8, $9)`,
        [
          brand.id,
          caption,
          finalId !== id ? [finalId] : [id],
          [id],
          pillar?.id ?? null,
          autopilot,
          autopilot ? new Date().toISOString() : null,
          autopilot ? "scheduled" : "pending_approval",
          slot.toISOString(),
        ],
      );
      made += 1;
    } catch (err) {
      console.error(`resolveAsSeparate: failed for media ${id}`, err);
    }
  }
  await query("delete from posts where id = $1", [draft.id]).catch(() => {});
  return made;
}
