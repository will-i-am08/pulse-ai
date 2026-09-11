import 'server-only';
import { query, queryOne, type ProactiveTrigger } from '@pulse/shared';

/** All routines (proactive triggers) for a brand, oldest first. */
export async function listRoutines(brandId: string): Promise<ProactiveTrigger[]> {
  return query<ProactiveTrigger>(
    `select * from proactive_triggers where brand_id = $1 order by created_at asc`,
    [brandId],
  );
}

/** True if this routine belongs to a brand the user owns (authorisation guard). */
export async function userOwnsRoutine(userId: string, routineId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `select t.id from proactive_triggers t
       join brands b on b.id = t.brand_id
      where t.id = $1 and b.owner_user_id = $2`,
    [routineId, userId],
  );
  return Boolean(row);
}
