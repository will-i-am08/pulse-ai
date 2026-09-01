'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { applyCorrection } from '@pulse/orchestrator';
import { getPost, updatePost } from '@/lib/data/posts';
import { logApproval } from '@/lib/data/approval-log';

function requireString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }
  return value;
}

function parseScheduledAt(formData: FormData): string | null {
  const raw = formData.get('scheduledAt');
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Approve → status='approved' (+ scheduled_at from the datetime input),
 * insert approval_log action='approved'. Caption is left untouched — edits
 * go through `editAndApprovePostAction` below.
 */
export async function approvePostAction(formData: FormData): Promise<void> {
  const postId = requireString(formData, 'postId');
  const brandId = requireString(formData, 'brandId');
  const scheduledAt = parseScheduledAt(formData);

  const post = await getPost(postId);
  if (!post) throw new Error(`approvePostAction: post ${postId} not found`);

  await updatePost(postId, { status: 'approved', scheduled_at: scheduledAt });
  await logApproval({
    postId,
    brandId,
    action: 'approved',
    before: { status: post.status },
    after: { status: 'approved', scheduled_at: scheduledAt },
  });

  revalidatePath(`/brands/${brandId}`);
}

/**
 * Edit → call orchestrator.applyCorrection(brandId, postId, before, after),
 * log 'edited', then approve as above (log 'approved').
 */
export async function editAndApprovePostAction(formData: FormData): Promise<void> {
  const postId = requireString(formData, 'postId');
  const brandId = requireString(formData, 'brandId');
  const afterCaption = requireString(formData, 'caption');
  const scheduledAt = parseScheduledAt(formData);

  const post = await getPost(postId);
  if (!post) throw new Error(`editAndApprovePostAction: post ${postId} not found`);
  const beforeCaption = post.caption ?? '';

  if (afterCaption !== beforeCaption) {
    await applyCorrection(brandId, postId, beforeCaption, afterCaption);
    await logApproval({
      postId,
      brandId,
      action: 'edited',
      before: { caption: beforeCaption },
      after: { caption: afterCaption },
    });
  }

  await updatePost(postId, { caption: afterCaption, status: 'approved', scheduled_at: scheduledAt });
  await logApproval({
    postId,
    brandId,
    action: 'approved',
    before: { status: post.status },
    after: { status: 'approved', scheduled_at: scheduledAt, caption: afterCaption },
  });

  revalidatePath(`/brands/${brandId}`);
}

/** Reject → status='rejected', log 'rejected'. */
export async function rejectPostAction(formData: FormData): Promise<void> {
  const postId = requireString(formData, 'postId');
  const brandId = requireString(formData, 'brandId');
  const note = formData.get('note');

  const post = await getPost(postId);
  if (!post) throw new Error(`rejectPostAction: post ${postId} not found`);

  await updatePost(postId, { status: 'rejected' });
  await logApproval({
    postId,
    brandId,
    action: 'rejected',
    before: { status: post.status },
    after: { status: 'rejected' },
    note: typeof note === 'string' && note.length > 0 ? note : undefined,
  });

  revalidatePath(`/brands/${brandId}`);
}
