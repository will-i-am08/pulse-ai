import 'server-only';
import { query, queryOne, type Pillar, type Post } from '@pulse/shared';

export type PlanPost = Post & { pillar_key: string | null; pillar_name: string | null };

/** The user's brand (oldest), or null. */
export async function ownerBrandId(userId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    'select id from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
  return row?.id ?? null;
}

/** Upcoming + recently-published posts for the calendar (next ~28 days + last 7). */
export async function listPlanPosts(brandId: string): Promise<PlanPost[]> {
  return query<PlanPost>(
    `select p.*, pl.key as pillar_key, pl.name as pillar_name
       from posts p
       left join pillars pl on pl.id = p.pillar_id
      where p.brand_id = $1
        and p.status in ('pending_approval','approved','scheduled','published')
        and (p.scheduled_at is null or p.scheduled_at between now() - interval '7 days' and now() + interval '28 days')
      order by coalesce(p.scheduled_at, p.created_at) asc`,
    [brandId],
  );
}

export async function listPillars(brandId: string): Promise<Pillar[]> {
  return query<Pillar>('select * from pillars where brand_id = $1 order by sort, created_at', [brandId]);
}

/** True if the post belongs to a brand this user owns (authorisation guard). */
export async function userOwnsPost(userId: string, postId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select p.id from posts p join brands b on b.id = p.brand_id
      where p.id = $1 and b.owner_user_id = $2`,
    [postId, userId],
  );
  return Boolean(row);
}

export async function userOwnsPillar(userId: string, pillarId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select pl.id from pillars pl join brands b on b.id = pl.brand_id
      where pl.id = $1 and b.owner_user_id = $2`,
    [pillarId, userId],
  );
  return Boolean(row);
}
