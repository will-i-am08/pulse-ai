import { NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { query, queryOne, type Brand, type InteractionKind } from '@pulse/shared';

export const dynamic = 'force-dynamic';

// Meta (Instagram + Facebook Page) webhook. GET verifies the subscription; POST
// receives signed events, normalises them into `interactions` rows (status
// 'new'), which the bot's engagement loop then triages. Publishing replies back
// is gated on the messaging/comment permissions (App Review).

/** GET — subscription verification handshake. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (p.get('hub.mode') === 'subscribe' && verifyToken && p.get('hub.verify_token') === verifyToken) {
    return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
  }
  return new NextResponse('forbidden', { status: 403 });
}

function validSignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function brandFor(assetId: string): Promise<Brand | null> {
  return queryOne<Brand>('select * from brands where ig_user_id = $1 or fb_page_id = $1 limit 1', [assetId]);
}

async function ingest(
  brand: Brand,
  input: { platform: string; kind: InteractionKind; author?: string; text?: string; external_id?: string },
): Promise<void> {
  // Idempotency: skip if we've already stored this external event.
  if (input.external_id) {
    const seen = await queryOne('select 1 from interactions where external_id = $1 limit 1', [input.external_id]);
    if (seen) return;
  }
  await query(
    `insert into interactions (brand_id, platform, kind, external_id, author, text, status)
     values ($1, $2, $3, $4, $5, $6, 'new')`,
    [brand.id, input.platform, input.kind, input.external_id ?? null, input.author ?? null, input.text ?? null],
  );
}

/** POST — signed event delivery. */
export async function POST(request: NextRequest) {
  const appSecret = process.env.META_APP_SECRET;
  const raw = await request.text();
  if (!appSecret || !validSignature(raw, request.headers.get('x-hub-signature-256'), appSecret)) {
    return new NextResponse('bad signature', { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse('bad json', { status: 400 });
  }

  const platform = body.object === 'instagram' ? 'instagram' : 'facebook';
  try {
    for (const entry of body.entry ?? []) {
      const brand = await brandFor(String(entry.id));
      if (!brand) continue;

      // Comments / mentions / Page feed comments.
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        if (change.field === 'comments') {
          await ingest(brand, { platform, kind: 'comment', author: v.from?.username ?? v.from?.name, text: v.text ?? v.message, external_id: v.id ?? v.comment_id });
        } else if (change.field === 'mentions') {
          await ingest(brand, { platform, kind: 'mention', external_id: v.comment_id ?? v.media_id });
        } else if (change.field === 'feed' && v.item === 'comment') {
          await ingest(brand, { platform: 'facebook', kind: 'comment', author: v.from?.name, text: v.message, external_id: v.comment_id });
        }
      }

      // Direct messages.
      for (const m of entry.messaging ?? []) {
        if (m.message?.text) {
          await ingest(brand, { platform, kind: 'dm', author: m.sender?.id, text: m.message.text, external_id: m.message.mid });
        }
      }
    }
  } catch (err) {
    console.error('meta webhook: processing failed', err);
    // Still 200 so Meta doesn't retry-storm; the error is logged.
  }

  return new NextResponse('ok', { status: 200 });
}
