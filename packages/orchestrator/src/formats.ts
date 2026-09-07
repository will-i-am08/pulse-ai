import { query, queryOne, publicMediaUrl, type Brand, type Post } from "@pulse/shared";
import { draftCaption } from "./draftCaption.js";
import { editImageForBrand } from "./imaging.js";
import { scheduleSlot } from "./scheduler.js";
import { ensurePillars, classifyPhotoPillar } from "./pillars.js";

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
  return { post, mediaUrl: coverId !== ids[0] ? publicMediaUrl(coverId) : publicMediaUrl(ids[0]!) };
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
