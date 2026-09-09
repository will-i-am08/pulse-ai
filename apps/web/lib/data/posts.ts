import 'server-only';
import { query, queryOne } from '@pulse/shared';
import type { Post, PostStatus } from '@pulse/shared';

export async function listPostsByStatus(brandId: string, statuses: PostStatus[]): Promise<Post[]> {
  return query<Post>(
    `select * from posts where brand_id = $1 and status = any($2::text[]) order by created_at asc`,
    [brandId, statuses]
  );
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
