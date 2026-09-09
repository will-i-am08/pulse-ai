'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { query, queryOne, sanitizeChatText } from '@pulse/shared';
import type { Interaction } from '@pulse/shared';
import { getGraphAdapter } from '@pulse/graph';
import { currentUser } from '@/lib/auth/current-user';
import { getBrandForUser } from '@/lib/data/brands';
import { getInteraction } from '@/lib/data/interactions';

function requireString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required field: ${key}`);
  }
  return value;
}

async function requireInteraction(interactionId: string, brandId: string): Promise<Interaction> {
  const user = await currentUser();
  if (!user) throw new Error('replies: not signed in');
  const brand = await getBrandForUser(brandId, user);
  if (!brand) throw new Error('replies: brand not found');
  const interaction = await getInteraction(interactionId, brandId);
  if (!interaction) throw new Error(`replies: interaction ${interactionId} not found`);
  if (interaction.status !== 'drafted' && interaction.status !== 'escalated') {
    throw new Error(`replies: interaction ${interactionId} is already ${interaction.status}`);
  }
  return interaction;
}

/**
 * Send (or edit + send) a reply to a drafted/escalated interaction.
 * Posts through the graph adapter, records the sent reply with the platform
 * id, and marks the interaction handled.
 * Anything already sent is excluded from the inbox, so this can't double-post.
 */
export async function sendReplyAction(formData: FormData): Promise<void> {
  const interactionId = requireString(formData, 'interactionId');
  const brandId = requireString(formData, 'brandId');
  const body = sanitizeChatText(requireString(formData, 'body'));

  const user = await currentUser();
  if (!user) throw new Error('sendReplyAction: not signed in');
  const brand = await getBrandForUser(brandId, user);
  if (!brand) throw new Error('sendReplyAction: brand not found');
  const interaction = await requireInteraction(interactionId, brandId);

  let externalReplyId: string | null = null;
  const graph = getGraphAdapter();
  if (!graph.reply) throw new Error('sendReplyAction: active graph adapter cannot post replies');
  const posted = await graph.reply({ brand, interaction, body });
  externalReplyId = posted.externalReplyId;

  const existingDraft = await queryOne<{ id: string; body: string }>(
    `select id, body from interaction_replies
      where interaction_id = $1 and actor = 'agent' and status = 'draft'
      order by created_at desc limit 1`,
    [interactionId]
  );
  if (existingDraft && existingDraft.body === body) {
    await query(`update interaction_replies set status = 'sent', external_reply_id = $1 where id = $2`, [
      externalReplyId,
      existingDraft.id,
    ]);
  } else {
    // Owner-edited (or owner-written for escalations): record the sent text as
    // theirs and leave the agent draft on record, so suggested-vs-sent stays
    // auditable. The leftover draft can't repost: chat "send" only acts on
    // interactions still in 'drafted', and this one is now handled.
    await query(
      `insert into interaction_replies (interaction_id, brand_id, body, actor, status, external_reply_id)
        values ($1, $2, $3, 'owner', 'sent', $4)`,
      [interactionId, brandId, body, externalReplyId]
    );
  }
  await query(`update interactions set status = 'auto_replied' where id = $1`, [interactionId]);

  revalidatePath(`/app/brands/${brandId}`);
}

/** Dismiss without replying — the owner handled it elsewhere or chose silence. */
export async function dismissReplyAction(formData: FormData): Promise<void> {
  const interactionId = requireString(formData, 'interactionId');
  const brandId = requireString(formData, 'brandId');

  await requireInteraction(interactionId, brandId);
  await query(`update interactions set status = 'resolved' where id = $1`, [interactionId]);

  revalidatePath(`/app/brands/${brandId}`);
}
