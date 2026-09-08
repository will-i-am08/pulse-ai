import 'server-only';
import { query, queryOne } from '@pulse/shared';
import type { Interaction } from '@pulse/shared';

export interface PendingReply {
  interaction: Interaction;
  /** Latest unsent agent-suggested reply, if the engine drafted one. */
  draftBody: string | null;
}

/**
 * Replies awaiting the owner: everything the engine drafted, plus escalations
 * the owner still needs to answer themselves. Lead hand-offs whose answer is
 * already posted are excluded — resending those would double-post.
 */
export async function listPendingReplies(brandId: string): Promise<PendingReply[]> {
  const rows = await query<Interaction>(
    `select i.* from interactions i
      where i.brand_id = $1
        and i.status in ('drafted', 'escalated')
        and not exists (
          select 1 from interaction_replies r
          where r.interaction_id = i.id and r.status = 'sent'
        )
      order by i.created_at asc`,
    [brandId]
  );
  return Promise.all(
    rows.map(async (interaction) => {
      const draft = await queryOne<{ body: string }>(
        `select body from interaction_replies
          where interaction_id = $1 and actor = 'agent' and status = 'draft'
          order by created_at desc limit 1`,
        [interaction.id]
      );
      return { interaction, draftBody: draft?.body ?? null };
    })
  );
}

export async function getInteraction(interactionId: string, brandId: string): Promise<Interaction | null> {
  return queryOne<Interaction>(`select * from interactions where id = $1 and brand_id = $2`, [
    interactionId,
    brandId,
  ]);
}
