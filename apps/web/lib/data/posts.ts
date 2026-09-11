import 'server-only';
import { query, queryOne } from '@pulse/shared';
import type { Post, PostStatus } from '@pulse/shared';

export async function listPostsByStatus(brandId: string, statuses: PostStatus[]): Promise<Post[]> {
  return query<Post>(
    `select * from posts where brand_id = $1 and status = any($2::text[]) order by created_at asc`,
    [brandId, statuses]
  );
}

/** Approved/scheduled posts that have a future time — date + caption only. */
export async function listUpcomingPosts(brandId: string, limit = 8): Promise<Post[]> {
  return query<Post>(
    `select * from posts
      where brand_id = $1
        and status = any($2::text[])
        and scheduled_at is not null
        and scheduled_at >= now()
      order by scheduled_at asc
      limit $3`,
    [brandId, ['approved', 'scheduled'], limit]
  );
}

function engagementNumber(engagement: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = engagement[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

export type PerformanceTopPost = {
  id: string;
  caption: string | null;
  published_at: string | null;
  likes: number;
  comments: number;
  reach: number;
};

export type BrandPerformance = {
  days: number;
  postsPublished: number;
  likes: number;
  comments: number;
  reach: number;
  saves: number;
  shares: number;
  topPosts: PerformanceTopPost[];
};

/** Aggregate stored engagement for published posts in the last N days. */
export async function getBrandPerformance(brandId: string, days = 30): Promise<BrandPerformance> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const posts = await query<Post>(
    `select * from posts
      where brand_id = $1
        and status = 'published'
        and published_at is not null
        and published_at >= $2
      order by published_at desc
      limit 100`,
    [brandId, since]
  );

  let likes = 0;
  let comments = 0;
  let reach = 0;
  let saves = 0;
  let shares = 0;

  const scored = posts.map((post) => {
    const engagement = (post.engagement ?? {}) as Record<string, unknown>;
    const postLikes = engagementNumber(engagement, 'likes', 'like_count');
    const postComments = engagementNumber(engagement, 'comments', 'comments_count');
    const postReach = engagementNumber(engagement, 'reach', 'views', 'impressions', 'post_impressions_unique');
    const postSaves = engagementNumber(engagement, 'saves', 'saved');
    const postShares = engagementNumber(engagement, 'shares');
    likes += postLikes;
    comments += postComments;
    reach += postReach;
    saves += postSaves;
    shares += postShares;
    return {
      id: post.id,
      caption: post.caption,
      published_at: post.published_at,
      likes: postLikes,
      comments: postComments,
      reach: postReach,
      score: postLikes + postComments * 3 + postReach * 0.01,
    };
  });

  const topPosts = [...scored]
    .sort((a, b) => b.score - a.score || (b.published_at ?? '').localeCompare(a.published_at ?? ''))
    .slice(0, 3)
    .map(({ score: _score, ...rest }) => rest);

  return {
    days,
    postsPublished: posts.length,
    likes,
    comments,
    reach,
    saves,
    shares,
    topPosts,
  };
}

export async function getPost(postId: string): Promise<Post | null> {
  return queryOne<Post>(`select * from posts where id = $1`, [postId]);
}

// jsonb / uuid[] columns need their SQL cast + (for jsonb) a stringified param —
// everything else is a plain scalar `column = $n`.
const JSONB_COLUMNS = new Set<keyof Post>(['engagement', 'captions', 'style_meta']);
const UUID_ARRAY_COLUMNS = new Set<keyof Post>(['media_ids', 'source_media_ids']);
const TEXT_ARRAY_COLUMNS = new Set<keyof Post>(['destinations']);

export async function updatePost(postId: string, patch: Partial<Post>): Promise<void> {
  const entries = Object.entries(patch) as [keyof Post, unknown][];
  if (entries.length === 0) return;

  const setClauses: string[] = [];
  const params: unknown[] = [];

  entries.forEach(([column, value]) => {
    const idx = params.length + 1;
    if (JSONB_COLUMNS.has(column)) {
      setClauses.push(`${column} = $${idx}::jsonb`);
      params.push(JSON.stringify(value));
    } else if (UUID_ARRAY_COLUMNS.has(column)) {
      setClauses.push(`${column} = $${idx}::uuid[]`);
      params.push(value);
    } else if (TEXT_ARRAY_COLUMNS.has(column)) {
      setClauses.push(`${column} = $${idx}::text[]`);
      params.push(value);
    } else {
      setClauses.push(`${column} = $${idx}`);
      params.push(value);
    }
  });

  params.push(postId);
  await query(`update posts set ${setClauses.join(', ')} where id = $${params.length}`, params);
}
