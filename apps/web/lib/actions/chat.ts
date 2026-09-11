'use server';
import 'server-only';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  queryOne,
  sanitizeChatText,
  type Brand,
  type InboundMedia,
  type MessageChannel,
} from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';

/** Cap web-thread uploads so a stray huge file can't wedge the action. */
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/**
 * Send a message from the in-app Thread. We run it through the very same
 * inbound pipeline a text message uses (`handleInbound`): it persists the
 * message, drafts a reply, and answers on the brand's SMS/Linq channel — so
 * the web thread and the text thread stay one conversation.
 *
 * A photo attached in the composer rides the exact same path: it's handed to
 * `handleInbound` as inbound `media`, so it's captured, styled, and captioned
 * just like a photo texted in from the floor. The only twist is that the bytes
 * are already in hand (uploaded via the form) rather than at a provider URL, so
 * we wrap the active channel with one whose `fetchMedia` returns those bytes.
 * Everything else — replies, typing, brand resolution — still uses the real
 * channel.
 *
 * `from` is the brand's client_phone (Twilio/Linq address), so the message
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

  // Optional photo from the composer. Only images ride this path.
  const file = formData.get('photo');
  const photo = file instanceof File && file.size > 0 ? file : null;
  if (photo && (!photo.type.startsWith('image/') || photo.size > MAX_PHOTO_BYTES)) {
    redirect('/app?chat=badphoto');
  }

  // Nothing to send.
  if (!body && !photo) redirect('/app');

  const from = brand!.client_phone;
  if (!from) redirect('/app?chat=nochannel');

  try {
    // Dynamic import: @pulse/gateway's barrel pulls orchestrator → satori/harfbuzz
    // WASM. A static import here aborts the whole /app serverless function on Vercel
    // (ENOENT hb.wasm) before the Thread page can render.
    const { handleInbound, activeChannel } = await import('@pulse/gateway');

    let media: InboundMedia[] = [];
    let channel: MessageChannel | undefined;

    if (photo) {
      const bytes = new Uint8Array(await photo.arrayBuffer());
      const contentType = photo.type;
      // A local key the wrapper resolves back to the uploaded bytes — never a
      // real URL, so nothing tries to re-fetch it over the network.
      const key = `web-upload:${randomUUID()}`;
      media = [{ url: key, contentType }];
      channel = withUploadedMedia(activeChannel(), { [key]: { bytes, contentType } });
    }

    await handleInbound(
      {
        from: from!,
        to: 'web',
        body,
        media,
        providerMessageId: `web:${randomUUID()}`,
        raw: { source: 'web-thread', userId: user!.id },
      },
      channel ? { channel } : undefined,
    );
  } catch (err) {
    console.error('sendChatMessageAction: handleInbound failed', err);
  }

  // LiveThread on /app polls for new rows — avoid a full redirect flash.
  revalidatePath('/app');
}

/**
 * Wrap a channel so `fetchMedia` returns bytes already in hand (a composer
 * upload) keyed by the sentinel URL we passed in, and delegates anything else
 * to the real channel. Sends, typing, and signature checks are untouched, so
 * Kip's reply still goes out over SMS/Linq.
 */
function withUploadedMedia(
  base: MessageChannel,
  blobs: Record<string, { bytes: Uint8Array; contentType: string }>,
): MessageChannel {
  return {
    name: base.name,
    send: (msg) => base.send(msg),
    sendTyping: base.sendTyping ? (to) => base.sendTyping!(to) : undefined,
    parseInbound: (payload) => base.parseInbound(payload),
    verifySignature: (url, params, signature) => base.verifySignature(url, params, signature),
    fetchMedia: async (item) => blobs[item.url] ?? base.fetchMedia(item),
  };
}
