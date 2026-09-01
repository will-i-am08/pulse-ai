import 'server-only';
import { serviceClient } from '@pulse/shared';
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
  const { error } = await serviceClient()
    .from('approval_log')
    .insert({
      post_id: entry.postId,
      brand_id: entry.brandId,
      action: entry.action,
      actor: entry.actor ?? 'operator',
      before: entry.before ?? null,
      after: entry.after ?? null,
      note: entry.note ?? null,
    });
  if (error) throw new Error(`logApproval: ${error.message}`);
}

export async function latestLogForPost(postId: string, action: ApprovalAction): Promise<ApprovalLogEntry | null> {
  const { data, error } = await serviceClient()
    .from('approval_log')
    .select('*')
    .eq('post_id', postId)
    .eq('action', action)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`latestLogForPost: ${error.message}`);
  return (data as ApprovalLogEntry | null) ?? null;
}
