import { query, queryOne, publicMediaUrl, type Brand, type MediaAsset, type Pillar, type Post } from "@pulse/shared";
import { draftCaption } from "./draftCaption.js";
import { editImageForBrand } from "./imaging.js";
import { scheduleSlot } from "./scheduler.js";

// The photo library: every photo the client texts in is already banked as a
// media_asset. "Available" = a client photo not currently committed to a live
// post — so a discarded draft returns its photo to the bank automatically, and
// we never repost the same shot. The gap-filler draws from here before nudging
// the client or falling back to a generated card.

const LIVE_STATUSES = "('pending_approval','approved','scheduled','publishing','published')";

/**
 * The oldest client photo not tied to any live post — the next one to reuse.
 * FIFO so photos go out roughly in the order they were sent. null when the bank
 * is empty.
 */
export async function pickUnusedClientPhoto(brandId: string): Promise<MediaAsset | null> {
  return queryOne<MediaAsset>(
    `select m.* from media_assets m
      where m.brand_id = $1 and m.kind = 'photo' and m.source = 'client'
        and not exists (
          select 1 from posts p
           where p.brand_id = $1
             and p.status in ${LIVE_STATUSES}
             and (m.id = any(p.source_media_ids) or m.id = any(p.media_ids))
        )
      order by m.created_at asc
      limit 1`,
    [brandId],
  );
}

/**
 * A short style cue drawn from the brand's real visual profile, to ground any
 * AI image generation in their actual look rather than generic stock. Empty when
 * we've nothing on file yet.
 */
export function visualReference(brand: Brand): string {
  const v = brand.visual ?? {};
  const bits: string[] = [];
  if (v.aesthetic) bits.push(v.aesthetic);
  if (v.colors?.length) bits.push(`colours ${v.colors.join(", ")}`);
  if (!bits.length) return "";
  return `Match the brand's real aesthetic — ${bits.join("; ")}.`;
}

/** How many client photos are sitting in the bank, ready to reuse. */
export async function bankedPhotoCount(brandId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from media_assets m
      where m.brand_id = $1 and m.kind = 'photo' and m.source = 'client'
        and not exists (
          select 1 from posts p
           where p.brand_id = $1
             and p.status in ${LIVE_STATUSES}
             and (m.id = any(p.source_media_ids) or m.id = any(p.media_ids))
        )`,
    [brandId],
  );
  return Number(row?.n ?? 0);
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
  const styledUrl = finalId !== photo.id ? publicMediaUrl(finalId) : null;
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

  return { post, mediaUrl: styledUrl ?? publicMediaUrl(postMediaIds[0]!) };
}
