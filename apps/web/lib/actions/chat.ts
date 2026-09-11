'use server';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { queryOne, sanitizeChatText, getServerEnv, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';

/**
 * Send a message from the in-app Thread. We run it through the very same
 * inbound pipeline a text message uses (`handleInbound`): it persists the
 * message, drafts a reply, and answers on the brand's connected channel — so
 * the web thread and the SMS/Discord thread stay one conversation.
 *
 * `from` is the address the active channel's resolver matches on (the brand's
 * discord channel id on Discord, otherwise its client_phone), so the message
 * resolves back to this brand. Errors in the reply path are swallowed by the
 * pipeline; the inbound message is persisted first, so it always shows.
 */
export async function sendChatMessageAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const brand = await queryOne<Brand>(
    'select * from brands where owner_user_id = $1 order by created_at asc limit 1',
    [user!.id],
  );
  if (!brand) redirect('/app');

  const body = sanitizeChatText(String(formData.get('q') ?? '')).trim();
  if (!body) redirect('/app');

  // Match the address the active channel resolves a brand by, so handleInbound
  // finds this brand instead of dropping the message.
  const which = getServerEnv().MESSAGE_CHANNEL;
  const from = which === 'discord' ? brand!.discord_channel_id ?? '' : brand!.client_phone;
  if (!from) redirect('/app?chat=nochannel');

  try {
    // Dynamic import: @pulse/gateway's barrel pulls orchestrator → satori/harfbuzz
    // WASM. A static import here aborts the whole /app serverless function on Vercel
    // (ENOENT hb.wasm) before the Thread page can render.
    const { handleInbound } = await import('@pulse/gateway');
    await handleInbound({
      from: from!,
      to: 'web',
      body,
      media: [],
      providerMessageId: `web:${randomUUID()}`,
      raw: { source: 'web-thread', userId: user!.id },
    });
  } catch (err) {
    console.error('sendChatMessageAction: handleInbound failed', err);
  }

  // LiveThread on /app polls for new rows — avoid a full redirect flash.
  revalidatePath('/app');
}
