import 'server-only';
import { query, queryOne } from '@pulse/shared';
import type { ApprovalAction, ApprovalLogEntry } from '@pulse/shared';

export async function logApproval(entry: {
  postId: string | null;
  brandId: string;
  action: ApprovalAction;
  actor?: string;
  before?: unknown;
  after?: unknown;
  note?: string;
}): Promise<void> {
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, before, after, note)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [
      entry.postId,
      entry.brandId,
      entry.action,
      entry.actor ?? 'operator',
      JSON.stringify(entry.before ?? null),
      JSON.stringify(entry.after ?? null),
      entry.note ?? null,
    ]
  );
}

export async function latestLogForPost(postId: string, action: ApprovalAction): Promise<ApprovalLogEntry | null> {
  return queryOne<ApprovalLogEntry>(
    `select * from approval_log where post_id = $1 and action = $2 order by created_at desc limit 1`,
    [postId, action]
  );
}
