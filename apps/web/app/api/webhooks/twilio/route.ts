// Twilio inbound SMS/MMS webhook. Must stay on the Node.js runtime — signature
// verification and the gateway/orchestrator pipeline it hands off to use
// Node-only APIs (crypto, etc.), which the Edge runtime doesn't support.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { activeChannel, handleInbound } from '@pulse/gateway';
import { getServerEnv } from '@pulse/shared';
import { scheduleKickoffDrain } from '@/lib/kickoffs/scheduleDrain';

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get('x-twilio-signature') ?? '';
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // Reconstruct the exact URL Twilio signed against — this must match the
  // webhook URL configured in the Twilio console byte-for-byte, so we build
  // it from APP_BASE_URL rather than trusting request.url (which can be
  // rewritten by a proxy).
  const env = getServerEnv();
  const signedUrl = `${env.APP_BASE_URL}/api/webhooks/twilio`;

  const channel = activeChannel();

  if (!channel.verifySignature(signedUrl, params, signature)) {
    console.warn('twilio webhook: signature verification failed');
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const inbound = channel.parseInbound(params);
    // Fire the full inbound pipeline (persist, capture media, hand off to the
    // orchestrator). handleInbound never throws for an unknown sender — it
    // logs and returns brandId:null — but we still guard the call in case of
    // an unexpected downstream failure, since Twilio must get a fast, cheap
    // response regardless.
    await handleInbound(inbound);
    // Drain any Kip self-kickoffs (queued first batch, drafts, etc.) after the
    // response — don't wait on the Railway worker tick.
    scheduleKickoffDrain('twilio');
  } catch (err) {
    console.error('twilio webhook: handleInbound failed', err);
  }

  // Empty response, no TwiML body needed — we reply asynchronously via
  // gateway.sendToBrand, not inline in the webhook response.
  return new NextResponse(null, { status: 204 });
}
