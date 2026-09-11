'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { query, queryOne, type Brand, type TriggerKind } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { userOwnsRoutine } from '@/lib/data/routines';
import { buildCron, type Cadence } from '@/lib/routines/cron';

const KINDS: TriggerKind[] = ['checkin', 'report', 'reminder', 'alert'];

async function ownerBrand(userId: string): Promise<Brand | null> {
  return queryOne<Brand>(
    'select * from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
}

/** Create a routine (proactive trigger) from the structured form. */
export async function createRoutineAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brand = await ownerBrand(user!.id);
  if (!brand) redirect('/app');

  const kind = String(formData.get('kind') ?? '') as TriggerKind;
  if (!KINDS.includes(kind)) redirect('/app/routines?error=kind');

  const cadence = (String(formData.get('cadence') ?? 'weekly') === 'daily' ? 'daily' : 'weekly') as Cadence;
  const dow = Number(formData.get('dow') ?? 1);
  const time = String(formData.get('time') ?? '09:00');

  let schedule: string;
  try {
    schedule = buildCron(cadence, dow, time);
  } catch {
    redirect('/app/routines?error=schedule');
  }

  await query(
    `insert into proactive_triggers (brand_id, kind, schedule, enabled) values ($1, $2, $3, true)`,
    [brand!.id, kind, schedule!],
  );
  revalidatePath('/app/routines');
}

/** Enable/disable a routine. */
export async function toggleRoutineAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const id = String(formData.get('id') ?? '');
  if (!id || !(await userOwnsRoutine(user!.id, id))) redirect('/app/routines');

  const enabled = String(formData.get('enabled') ?? '') === 'on';
  await query(`update proactive_triggers set enabled = $1 where id = $2`, [enabled, id]);
  revalidatePath('/app/routines');
}

/** Delete a routine. */
export async function deleteRoutineAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const id = String(formData.get('id') ?? '');
  if (!id || !(await userOwnsRoutine(user!.id, id))) redirect('/app/routines');

  await query(`delete from proactive_triggers where id = $1`, [id]);
  revalidatePath('/app/routines');
}
