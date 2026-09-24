/**
 * Weekly organic creative refresh — draft a look from a library photo.
 * Looks stay as engine; we do not park a 1/2/3 picker.
 */
import { query, queryOne, type Brand } from "@pulse/shared";
import { draftPostFromPhoto, pickFreshPhoto } from "./library.js";
import {
  generatePhotoVariants,
  getPendingVariantPick,
  variantMediaUrls,
  lookPackForBrand,
} from "./variants.js";
import { aiSpendWeekKey } from "./aiSpend.js";
import { ensurePillars } from "./pillars.js";

export type CreativeRefreshResult =
  | {
      brandId: string;
      sms: string;
      mediaUrls: string[];
      mediaUrl?: string;
    }
  | null;

function readRefreshState(brand: Brand): { last_at?: string; week_key?: string } {
  return brand.facts?.creative_refresh ?? {};
}

async function markRefreshSent(brandId: string): Promise<void> {
  const brand = await queryOne<Brand>(`select facts from brands where id = $1`, [brandId]);
  const facts = {
    ...(brand?.facts ?? {}),
    creative_refresh: { last_at: new Date().toISOString(), week_key: aiSpendWeekKey() },
  };
  await query(`update brands set facts = $1::jsonb where id = $2`, [JSON.stringify(facts), brandId]);
}

/** True when the brand already got a creative refresh this ISO week. */
export function alreadyRefreshedThisWeek(brand: Brand): boolean {
  const state = readRefreshState(brand);
  return state.week_key === aiSpendWeekKey();
}

/** Heuristic: needs refresh if no pending drafts, pillar gaps OR soft underperformance, and unused photos. */
export async function brandNeedsCreativeRefresh(brand: Brand): Promise<boolean> {
  if (brand.status !== "active") return false;
  if (alreadyRefreshedThisWeek(brand)) return false;

  const pending = await queryOne<{ n: number }>(
    `select count(*)::int as n from posts
      where brand_id = $1 and status in ('pending_approval','draft')`,
    [brand.id],
  );
  if (Number(pending?.n ?? 0) > 0) return false;

  // Don't stack on an unresolved variant park (extra safety).
  if (await getPendingVariantPick(brand.id)) return false;

  const photo = await pickFreshPhoto(brand.id);
  if (!photo) return false;

  // Pillar gap: any pillar below weekly target in the next 7 days.
  const gap = await queryOne<{ n: number }>(
    `select count(*)::int as n from pillars p
      where p.brand_id = $1 and p.posts_per_week > 0
        and (
          select count(*)::int from posts
           where brand_id = p.brand_id and pillar_id = p.id
             and status in ('pending_approval','approved','scheduled')
             and scheduled_at between now() and now() + interval '7 days'
        ) < p.posts_per_week`,
    [brand.id],
  );
  if (Number(gap?.n ?? 0) > 0) return true;

  // Soft fatigue: published posts in last 14d with engagement below brand median impressions.
  const soft = await queryOne<{ soft: boolean }>(
    `with recent as (
       select coalesce((engagement->>'impressions')::numeric, (engagement->>'reach')::numeric, 0) as imp
         from posts
        where brand_id = $1 and status = 'published' and published_at > now() - interval '14 days'
     ),
     med as (
       select percentile_cont(0.5) within group (order by imp) as mid from recent
     ),
     last3 as (
       select coalesce((engagement->>'impressions')::numeric, (engagement->>'reach')::numeric, 0) as imp
         from posts
        where brand_id = $1 and status = 'published'
        order by published_at desc nulls last
        limit 3
     )
     select (
       (select count(*) from recent) >= 4
       and (select mid from med) is not null
       and (select avg(imp) from last3) < (select mid from med) * 0.7
     ) as soft`,
    [brand.id],
  );
  return Boolean(soft?.soft);
}

/**
 * Run one creative refresh for a brand: library photo → styled draft + optional looks.
 * Talks like a person. Does not park Reply 1/2/3.
 */
export async function runCreativeRefreshForBrand(brand: Brand): Promise<CreativeRefreshResult> {
  if (!(await brandNeedsCreativeRefresh(brand))) return null;

  const photo = await pickFreshPhoto(brand.id);
  if (!photo) return null;

  const pillars = await ensurePillars(brand.id);
  const pillar = pillars[0];
  if (!pillar) return null;

  const pack = lookPackForBrand(brand);
  const gen = await generatePhotoVariants(brand, photo.id, { pack });
  const drafted = await draftPostFromPhoto(brand, photo, pillar);
  if (!drafted?.post) return null;

  await markRefreshSent(brand.id);

  const urls = gen.ok && gen.mediaIds.length
    ? variantMediaUrls(gen.mediaIds)
    : drafted.mediaUrl
      ? [drafted.mediaUrl]
      : [];
  return {
    brandId: brand.id,
    sms:
      `Your feed's going a bit stale — leaned a ${pack.smsName} grade from a photo you already sent. ` +
      `Say if you want a punchier cut. Nothing posts until you say yes.`,
    mediaUrls: urls,
    mediaUrl: urls[0] ?? drafted.mediaUrl ?? undefined,
  };
}

/** Sweep active brands; returns SMS payloads for the worker to deliver. */
export async function runCreativeRefreshPass(limit = 8): Promise<
  Array<{ brandId: string; sms: string; mediaUrls: string[]; mediaUrl?: string }>
> {
  const brands = await query<Brand>(
    `select * from brands where status = 'active' order by updated_at asc limit 40`,
  );
  const out: Array<{ brandId: string; sms: string; mediaUrls: string[]; mediaUrl?: string }> = [];
  for (const brand of brands) {
    if (out.length >= limit) break;
    try {
      const r = await runCreativeRefreshForBrand(brand);
      if (r) out.push(r);
    } catch (err) {
      console.error(`creativeRefresh: brand ${brand.id} failed`, err);
    }
  }
  return out;
}

/** Test helper — underperformance SQL shape (exported for unit tests). */
export async function countPendingDrafts(brandId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from posts where brand_id = $1 and status in ('pending_approval','draft')`,
    [brandId],
  );
  return Number(row?.n ?? 0);
}

export type { Post };
