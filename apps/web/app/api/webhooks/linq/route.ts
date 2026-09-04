import { NextResponse, type NextRequest } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { query, queryOne } from '@pulse/shared';

export const dynamic = 'force-dynamic';

// Linq (linqapp.com) inbound webhook — `message.received`. This runs on the
// serverless function, which has no native image libraries, so it does NO
// processing: it verifies the Svix-style signature and drops the message onto
// the `pending_inbound` queue. The bot (with sharp/resvg) processes + replies.
//
// Signature: headers webhook-id / webhook-timestamp / webhook-signature; secret
// is whsec_<base64>; signed content is `{id}.{timestamp}.{rawBody}`.
function verify(secret: string, id: string, ts: string, body: string, sigHeader: string): boolean {
  const keyB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const key = Buffer.from(keyB64, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  const exp = Buffer.from(expected);
  return sigHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1]! : part;
    const got = Buffer.from(sig);
    return got.length === exp.length && timingSafeEqual(got, exp);
  });
}

export async function POST(request: NextRequest) {
  const secret = process.env.LINQ_WEBHOOK_SECRET;
  const raw = await request.text();
  const id = request.headers.get('webhook-id') ?? '';
  const ts = request.headers.get('webhook-timestamp') ?? '';
  const sig = request.headers.get('webhook-signature') ?? request.headers.get('x-webhook-signature') ?? '';

  if (!secret || !id || !ts || !sig || !verify(secret, id, ts, raw, sig)) {
    return new NextResponse('bad signature', { status: 401 });
  }
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    return new NextResponse('stale', { status: 400 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse('bad json', { status: 400 });
  }

  if (payload?.event_type === 'message.received') {
    const data = payload.data ?? {};
    const parts: any[] = Array.isArray(data.parts) ? data.parts : [];
    const from = String(data?.sender_handle?.handle ?? '');
    const providerId = String(data?.id ?? '');
    const body = parts.filter((p) => p?.type === 'text' && p?.value).map((p) => p.value).join(' ').trim();
    const media = parts
      .filter((p) => p?.type !== 'text')
      .map((p) => ({ url: String(p?.url ?? p?.value ?? ''), contentType: String(p?.content_type ?? 'image/jpeg') }))
      .filter((m) => /^https?:\/\//i.test(m.url));

    if (from) {
      try {
        // Idempotency: skip a redelivered provider message.
        const seen = providerId
          ? await queryOne('select 1 from pending_inbound where provider_message_id = $1 limit 1', [providerId])
          : null;
        if (!seen) {
          await query(
            `insert into pending_inbound (channel, from_handle, body, media, provider_message_id)
             values ('linq', $1, $2, $3::jsonb, $4)`,
            [from, body || null, JSON.stringify(media), providerId || null],
          );
        }
      } catch (err) {
        console.error('linq webhook: enqueue failed', err);
      }
    }
  }
  return new NextResponse('ok', { status: 200 });
}
