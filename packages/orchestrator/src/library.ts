import { query, queryOne, type Brand, type MediaAsset, type Pillar, type Post } from "@pulse/shared";
import { draftCaption } from "./draftCaption.js";
import { editImageForBrand } from "./imaging.js";
import { previewUrlForPost } from "./mockup.js";
import { scheduleSlot } from "./scheduler.js";

// The photo library: every photo the client texts in is banked as a media_asset,
// forever. Two pools:
//   • FRESH  — never posted. The bot reuses these on its own (gap-fills, "draft one").
//   • USED   — already posted. Kept forever, but only reused when the client asks
//              ("use an old one"), and always available as reference for AI images.
// A photo "in flight" (in a post awaiting or heading to publish) is off-limits.
const IN_FLIGHT_STATUSES = "('pending_approval','approved','scheduled','publishing')";
const NOT_IN_FLIGHT = `not exists (
       select 1 from posts p
        where p.brand_id = $1
          and p.status in ${IN_FLIGHT_STATUSES}
          and (m.id = any(p.source_media_ids) or m.id = any(p.media_ids)))`;
const EVER_POSTED = `exists (
       select 1 from posts p
        where p.brand_id = $1 and (m.id = any(p.source_media_ids) or m.id = any(p.media_ids)))`;

/**
 * A FRESH photo — never posted — for the bot to reuse on its own. Oldest first
 * (FIFO). null when there are no unused photos.
 */
export async function pickFreshPhoto(brandId: string): Promise<MediaAsset | null> {
  return queryOne<MediaAsset>(
    `select m.* from media_assets m
      where m.brand_id = $1 and m.kind = 'photo' and m.source = 'client'
        and ${NOT_IN_FLIGHT} and not ${EVER_POSTED}
      order by m.created_at asc
      limit 1`,
    [brandId],
  );
}

/** Several fresh photos (oldest first) — for bundling into a library carousel. */
export async function pickFreshPhotos(brandId: string, n: number): Promise<MediaAsset[]> {
  return query<MediaAsset>(
    `select m.* from media_assets m
      where m.brand_id = $1 and m.kind = 'photo' and m.source = 'client'
        and ${NOT_IN_FLIGHT} and not ${EVER_POSTED}
      order by m.created_at asc
      limit $2`,
    [brandId, Math.max(1, Math.min(n, 10))],
  );
}

/**
 * A previously-posted photo to reuse ON THE CLIENT'S REQUEST — least-recently-used
 * first. Falls back to any not-in-flight photo if none have been posted yet. null
 * only when the client has never sent a photo.
 */
export async function pickReusablePhoto(brandId: string): Promise<MediaAsset | null> {
  return queryOne<MediaAsset>(
    `select m.* from media_assets m
      where m.brand_id = $1 and m.kind = 'photo' and m.source = 'client' and ${NOT_IN_FLIGHT}
      order by (
        select max(coalesce(p.published_at, p.scheduled_at, p.created_at)) from posts p
         where p.brand_id = $1 and (m.id = any(p.source_media_ids) or m.id = any(p.media_ids))
      ) asc nulls last, m.created_at asc
      limit 1`,
    [brandId],
  );
}

/** How many FRESH (never-posted) photos the bot can reuse on its own right now. */
export async function bankedPhotoCount(brandId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from media_assets m
      where m.brand_id = $1 and m.kind = 'photo' and m.source = 'client'
        and ${NOT_IN_FLIGHT} and not ${EVER_POSTED}`,
    [brandId],
  );
  return Number(row?.n ?? 0);
}

/**
 * A short style cue for grounding AI image generation in the brand's REAL photos.
 * Uses the derived visual aesthetic/colours if we have them; otherwise, when the
 * brand has real photos on file, still nudges the model toward their own look.
 */
export function visualReference(brand: Brand, hasRealPhotos = false): string {
  const v = brand.visual ?? {};
  const bits: string[] = [];
  if (v.aesthetic) bits.push(v.aesthetic);
  if (v.aesthetic_notes) bits.push(v.aesthetic_notes);
  if (v.photo_treatment) bits.push(`photo treatment: ${v.photo_treatment}`);
  if (v.colors?.length) bits.push(`colours ${v.colors.join(", ")}`);
  if (v.fonts?.length) bits.push(`fonts ${v.fonts.join(", ")}`);
  if (bits.length) return `Match the brand's real aesthetic — ${bits.join("; ")}.`;
  if (hasRealPhotos) return "Match the natural look and feel of the brand's own photography — real, unstocky.";
  return "";
}

/**
 * Draft a post for `pillar` from an already-banked photo — style it, caption it,
 * schedule it. Mirrors the inbound-photo path but for a photo we're reusing from
 * the library. Autopilot pillars schedule themselves; others land pending_approval.
 */
export async function draftPostFromPhoto(
  brand: Brand,
  photo: MediaAsset,
  pillar: Pillar,
): Promise<{ post: Post; mediaUrl: string | null } | null> {
  const { caption } = await draftCaption(brand.id, [photo.id]);

  // Style from the original, falling back to the original if editing is unavailable.
  let finalId = photo.id;
  const editedId = await editImageForBrand(brand, photo.id).catch(() => null);
  if (editedId) finalId = editedId;
  const postMediaIds = finalId !== photo.id ? [finalId, photo.id] : [photo.id];

  const slot = await scheduleSlot({
    brandId: brand.id,
    platform: "instagram",
    pillarId: pillar.id,
    postsPerWeek: pillar.posts_per_week,
  });
  const autopilot = Boolean(pillar.autopilot);

  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, pillar_id, is_auto, hold_notified_at, platform, status, scheduled_at)
     values ($1, $2, $3::uuid[], $4::uuid[], '{}'::jsonb, $5, $6, $7, 'instagram', $8, $9)
     returning *`,
    [
      brand.id,
      caption,
      postMediaIds,
      [photo.id],
      pillar.id,
      autopilot,
      autopilot ? new Date().toISOString() : null,
      autopilot ? "scheduled" : "pending_approval",
      slot.toISOString(),
    ],
  );
  if (!post) return null;

  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [
      post.id,
      brand.id,
      JSON.stringify({ caption, scheduled_at: slot.toISOString(), pillar: pillar.key, from_library: true }),
      "Drafted from a banked photo (library reuse)",
    ],
  ).catch(() => {});

  if (autopilot) {
    await query(
      `insert into approval_log (post_id, brand_id, action, actor, note)
       values ($1, $2, 'approved', 'system-autopilot', $3)`,
      [post.id, brand.id, "Auto-scheduled from library (pillar on autopilot)"],
    ).catch(() => {});
  }

  return { post, mediaUrl: await previewUrlForPost(brand, post, post.media_ids[0]!) };
}
