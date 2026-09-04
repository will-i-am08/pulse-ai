'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { query } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { userOwnsPost, userOwnsPillar } from '@/lib/data/plan';

async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error('unauthorized');
  return user;
}

/** Move a post to a new time (datetime-local string). */
export async function reschedulePostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = String(formData.get('postId') ?? '');
  const when = String(formData.get('scheduledAt') ?? '');
  if (!postId || !when || !(await userOwnsPost(user.id, postId))) return;
  const dt = new Date(when);
  if (Number.isNaN(dt.getTime())) return;
  await query(`update posts set scheduled_at = $1 where id = $2`, [dt.toISOString(), postId]);
  revalidatePath('/app/plan');
}

/** Remove a post from the plan (reject it — never touches published posts). */
export async function removePostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = String(formData.get('postId') ?? '');
  if (!postId || !(await userOwnsPost(user.id, postId))) return;
  await query(
    `update posts set status = 'rejected' where id = $1 and status in ('pending_approval','approved','scheduled')`,
    [postId],
  );
  revalidatePath('/app/plan');
}

/** Approve a pending post straight from the calendar. */
export async function approvePostAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const postId = String(formData.get('postId') ?? '');
  if (!postId || !(await userOwnsPost(user.id, postId))) return;
  await query(`update posts set status = 'approved' where id = $1 and status = 'pending_approval'`, [postId]);
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, note)
     select id, brand_id, 'approved', 'dashboard', 'Approved from calendar' from posts where id = $1`,
    [postId],
  );
  revalidatePath('/app/plan');
}

/** Update a pillar's cadence / autopilot / name from the settings panel. */
export async function setPillarAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const pillarId = String(formData.get('pillarId') ?? '');
  if (!pillarId || !(await userOwnsPillar(user.id, pillarId))) return;

  const autopilot = formData.get('autopilot') !== null; // checkbox present = on
  const perWeekRaw = formData.get('postsPerWeek');
  const perWeek = perWeekRaw !== null ? Math.max(0, Math.min(14, Number(perWeekRaw) || 0)) : null;

  if (perWeek !== null) {
    await query(`update pillars set autopilot = $1, posts_per_week = $2 where id = $3`, [autopilot, perWeek, pillarId]);
  } else {
    await query(`update pillars set autopilot = $1 where id = $2`, [autopilot, pillarId]);
  }
  revalidatePath('/app/plan');
}
