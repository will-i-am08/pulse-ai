/**
 * Photo → N vertical variant picks (Kive-style creative volume, SMS-native).
 * Parks three looks; owner replies 1/2/3 (or skip/original).
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  query,
  queryOne,
  getMedia,
  putMedia,
  getServerEnv,
  publicMediaUrl,
  brandVoiceProfileSchema,
  type Brand,
  type Post,
} from "@pulse/shared";
import { editImageForBrand } from "./imaging.js";
import { assertAiSpendAllowed, recordAiSpend } from "./aiSpend.js";
import {
  getLookPack,
  resolveLookPackFromNiche,
  type LookFrameGravity,
  type LookPack,
  type LookPackId,
} from "./lookPacks/index.js";

export const VARIANT_COUNT = 3;

/** Crop/letterbox a photo into 4:5 feed frame. Gravity picks which region survives. */
export async function frameFeedImage(
  imgBytes: Uint8Array,
  gravity: LookFrameGravity | string = "centre",
): Promise<Buffer> {
  const width = 1080;
  const height = 1350;
  const position = gravity || "centre";
  return sharp(Buffer.from(imgBytes))
    .rotate()
    .resize({ width, height, fit: "cover", position })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Mean absolute pixel diff on a 32×32 greyscale downscale. True when frames look near-identical. */
export async function imagesTooSimilar(a: Buffer, b: Buffer): Promise<boolean> {
  const size = 32;
  const [ra, rb] = await Promise.all([
    sharp(a).resize(size, size, { fit: "fill" }).greyscale().raw().toBuffer(),
    sharp(b).resize(size, size, { fit: "fill" }).greyscale().raw().toBuffer(),
  ]);
  let acc = 0;
  for (let i = 0; i < ra.length; i++) acc += Math.abs(ra[i]! - rb[i]!);
  return acc / ra.length < 14;
}

async function storeFramedBuffer(brandId: string, jpeg: Buffer): Promise<string> {
  const newId = randomUUID();
  await query(
    `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
     values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
    [newId, brandId, newId],
  );
  await putMedia(newId, new Uint8Array(jpeg), "image/jpeg");
  return newId;
}

/** Resolve the active look pack for a brand (override → niche → generic). */
export function lookPackForBrand(brand: Brand, nicheHint?: string | null): LookPack {
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const fromVoice = profile.photo_style?.look_pack;
  if (fromVoice) return getLookPack(fromVoice);
  const fromFacts = brand.facts?.look_pack;
  if (fromFacts) return getLookPack(fromFacts);
  const niche =
    nicheHint ||
    brand.facts?.differentiators ||
    brand.icp?.segments?.join(" ") ||
    (brand.facts?.lab ? "" : brand.name);
  return resolveLookPackFromNiche(niche);
}

/** Persist look pack preference onto voice photo_style + facts. */
export async function setBrandLookPack(brandId: string, packId: LookPackId): Promise<void> {
  const brand = await queryOne<Brand>(
    `select brand_voice_profile, facts from brands where id = $1`,
    [brandId],
  );
  if (!brand) return;
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const nextProfile = {
    ...profile,
    photo_style: { ...profile.photo_style, look_pack: packId },
  };
  const facts = { ...(brand.facts ?? {}), look_pack: packId };
  await query(`update brands set brand_voice_profile = $1::jsonb, facts = $2::jsonb where id = $3`, [
    JSON.stringify(nextProfile),
    JSON.stringify(facts),
    brandId,
  ]);
}

export type VariantGenResult =
  | {
      ok: true;
      mediaIds: string[];
      labels: string[];
      pack: LookPack;
      spendSms: null;
    }
  | { ok: false; spendSms: string; reason: "spend_cap" | "no_replicate" | "failed" };

/**
 * Generate three distinct looks from one source photo.
 * Falls back gracefully when Replicate is off or spend is capped.
 */
export async function generatePhotoVariants(
  brand: Brand,
  mediaId: string,
  opts?: { count?: number; pack?: LookPack; extraHint?: string },
): Promise<VariantGenResult> {
  if (!getServerEnv().REPLICATE_API_TOKEN) {
    return { ok: false, spendSms: "", reason: "no_replicate" };
  }
  const count = Math.min(VARIANT_COUNT, Math.max(1, opts?.count ?? VARIANT_COUNT));
  // Soft-refuse if 3 image edits would blow the weekly cap.
  for (let i = 0; i < count; i++) {
    const refuse = assertAiSpendAllowed(brand, "image");
    if (refuse) return { ok: false, spendSms: refuse, reason: "spend_cap" };
  }

  const pack = opts?.pack ?? lookPackForBrand(brand);
  const hint = opts?.extraHint?.trim();
  const directions = pack.variantDirections.slice(0, count);
  const mediaIds: string[] = [];
  const framedBuffers: Buffer[] = [];

  for (let i = 0; i < directions.length; i++) {
    const dir = directions[i]!;
    const gravity = pack.variantFrames[i] ?? "centre";
    let accepted: Buffer | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const request = [
        pack.baseDirection,
        `Look ${i + 1} of ${count}: ${dir}`,
        "This look MUST be a different crop from the other looks.",
        attempt === 1
          ? "CROP HARDER — previous attempt was too similar. Change framing dramatically."
          : "",
        pack.negativeCues ? `Avoid: ${pack.negativeCues}.` : "",
        hint ? `Also: ${hint}.` : "",
        "Output must stay truthful to the real subject in the photo.",
        brand.facts?.lab && pack.id !== "cafe_warm"
          ? "Do not restyle this into a café, coffee shop, espresso machine, or bakery scene."
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      const edited = await editImageForBrand(brand, mediaId, request).catch(() => null);
      if (!edited) continue;
      await recordAiSpend(brand.id, "image");
      const blob = await getMedia(edited);
      if (!blob) continue;
      const framed = await frameFeedImage(blob.bytes, gravity);

      let similar = false;
      for (const prev of framedBuffers) {
        if (await imagesTooSimilar(framed, prev)) {
          similar = true;
          break;
        }
      }
      if (similar && attempt === 0) continue;
      accepted = framed;
      break;
    }

    if (!accepted) continue;
    framedBuffers.push(accepted);
    const stored = await storeFramedBuffer(brand.id, accepted).catch(() => null);
    if (stored) mediaIds.push(stored);
  }
  if (mediaIds.length === 0) {
    return { ok: false, spendSms: "", reason: "failed" };
  }

  const labels = mediaIds.map((_, i) => `Look ${i + 1}`);
  return { ok: true, mediaIds, labels, pack, spendSms: null };
}

/** Holding draft awaiting 1/2/3 (30-minute window, same as carousel park). */
export async function getPendingVariantPick(brandId: string): Promise<Post | null> {
  return queryOne<Post>(
    `select * from posts
      where brand_id = $1 and status = 'draft'
        and coalesce(style_meta->>'variant_pick','') = 'true'
        and created_at > now() - interval '30 minutes'
      order by created_at desc
      limit 1`,
    [brandId],
  );
}

export async function parkVariantPick(
  brandId: string,
  sourceMediaId: string,
  variantMediaIds: string[],
  packId: string,
): Promise<Post> {
  // Drop any older unresolved variant parks so 1/2/3 is unambiguous.
  await query(
    `update posts set status = 'rejected'
      where brand_id = $1 and status = 'draft'
        and coalesce(style_meta->>'variant_pick','') = 'true'`,
    [brandId],
  );
  const post = await queryOne<Post>(
    `insert into posts (brand_id, caption, media_ids, source_media_ids, style_meta, format, platform, status)
     values ($1, null, $2::uuid[], $3::uuid[], $4::jsonb, 'feed', 'instagram', 'draft')
     returning *`,
    [
      brandId,
      variantMediaIds,
      [sourceMediaId],
      JSON.stringify({
        variant_pick: true,
        look_pack: packId,
        variant_labels: variantMediaIds.map((_, i) => `Look ${i + 1}`),
      }),
    ],
  );
  if (!post) throw new Error("Failed to park variant pick");
  return post;
}

export type VariantChoice =
  | { kind: "index"; index: number }
  | { kind: "skip" }
  | { kind: "original" };

/** Parse "1" / "2" / "3" / "look 2" / "skip" / "original". */
export function parseVariantChoice(body: string | null | undefined): VariantChoice | null {
  if (!body) return null;
  const t = body.trim().toLowerCase();
  if (!t) return null;
  if (/^\s*(skip|none|cancel|nope)\b/i.test(t)) return { kind: "skip" };
  if (/^\s*(original|as is|as-is|unedited|raw)\b/i.test(t)) return { kind: "original" };
  const m =
    t.match(/^\s*([123])\s*[.!?]?\s*$/) ||
    t.match(/^\s*(?:look|option|number|#)\s*([123])\b/) ||
    t.match(/^\s*(one|two|three)\b/);
  if (!m) return null;
  const raw = m[1]!;
  const map: Record<string, number> = { "1": 0, "2": 1, "3": 2, one: 0, two: 1, three: 2 };
  const index = map[raw];
  if (index == null) return null;
  return { kind: "index", index };
}

export function variantPickSms(pack: LookPack, n: number): string {
  const count = n === 1 ? "One" : n === 2 ? "Two" : "Three";
  const picks = n <= 1 ? "Reply 1 to pick it" : n === 2 ? "Reply 1 or 2 to pick one" : "Reply 1, 2, or 3 to pick one";
  return `${count} ${pack.smsName} looks from your photo.\n\n${picks} (or original / skip).`;
}

export function variantMediaUrls(mediaIds: string[]): string[] {
  return mediaIds.map((id) => publicMediaUrl(id));
}

/** Drop a parked variant pick without drafting. */
export async function discardVariantPick(post: Post): Promise<void> {
  await query(`update posts set status = 'rejected' where id = $1`, [post.id]);
}

/**
 * Turn a parked variant pick into a normal pending_approval feed draft.
 * Caller supplies caption + schedule helpers to avoid circular imports.
 */
export async function promoteVariantToDraft(params: {
  brand: Brand;
  parked: Post;
  chosenMediaId: string;
  caption: string;
  pillarId: string | null;
  pillarName: string | null;
  slot: Date;
  styleMeta?: Record<string, unknown>;
  destinations?: string[];
  captions?: Record<string, string>;
  linkOffer?: unknown;
}): Promise<Post> {
  const {
    brand,
    parked,
    chosenMediaId,
    caption,
    pillarId,
    slot,
    styleMeta = {},
    destinations = [],
    captions = {},
    linkOffer = null,
  } = params;
  const sourceIds = parked.source_media_ids?.length
    ? parked.source_media_ids
    : [chosenMediaId];
  const packId =
    typeof parked.style_meta?.look_pack === "string" ? parked.style_meta.look_pack : undefined;
  const post = await queryOne<Post>(
    `update posts set
        caption = $1,
        media_ids = $2::uuid[],
        source_media_ids = $3::uuid[],
        style_meta = $4::jsonb,
        pillar_id = $5,
        is_auto = false,
        hold_notified_at = null,
        platform = 'instagram',
        status = 'pending_approval',
        scheduled_at = $6,
        destinations = $7::text[],
        captions = $8::jsonb,
        link_offer = $9::jsonb,
        format = 'feed'
      where id = $10
      returning *`,
    [
      caption,
      [chosenMediaId],
      sourceIds,
      JSON.stringify({
        ...styleMeta,
        variant_pick: false,
        variant_chosen: true,
        ...(packId ? { look_pack: packId } : {}),
      }),
      pillarId,
      slot.toISOString(),
      destinations,
      JSON.stringify(captions),
      linkOffer ? JSON.stringify(linkOffer) : null,
      parked.id,
    ],
  );
  if (!post) throw new Error("Failed to promote variant pick");
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, after, note)
     values ($1, $2, 'draft_created', 'system', $3::jsonb, $4)`,
    [
      post.id,
      brand.id,
      JSON.stringify({ caption, scheduled_at: slot.toISOString(), variant: true }),
      "Drafted from variant pick",
    ],
  );
  return post;
}
