// Twilio inbound SMS/MMS webhook. Must stay on the Node.js runtime — signature
// verification and the gateway/orchestrator pipeline it hands off to use
// Node-only APIs (crypto, etc.), which the Edge runtime doesn't support.
export const runtime = 'nodejs';
// `handleInbound` runs the full turn inline: an unconditional ~2.8s human-pacing
// burst sleep, the LLM call, then paced sends — a measured floor of ~7.4s before
// the model is even counted. Vercel's default 10-15s cap kills the isolate
// mid-turn, so the reply is never dispatched AND the queued kickoff drain never
// runs, with nothing logged.
//
// Kickoff drains also run in Next `after()` on this same function budget.
// Photo carousels (multiple fal gens + LLM + overlay) routinely exceed 60s —
// the isolate then dies with the row left `running`, and the owner gets
// "Already on that…" until the 5-min stale reaper. Match lab/operator (300)
// so after() can finish; DRAFT_SLOT_TIMEOUT_MS is 75s and needs headroom.
export const maxDuration = 300;

import { NextResponse, after } from 'next/server';
import { activeChannel, handleInbound } from '@pulse/gateway';
import { appBaseUrl } from '@pulse/shared';
import { scheduleKickoffDrain } from '@/lib/kickoffs/scheduleDrain';

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const signature = request.headers.get('x-twilio-signature') ?? '';
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  // Reconstruct the exact URL Twilio signed against — this must match the
  // webhook URL configured in the Twilio console byte-for-byte, so we build
  // it from APP_BASE_URL rather than trusting request.url (which can be
  // rewritten by a proxy). `appBaseUrl()` strips a trailing slash: with one
  // left on, this becomes `https://host//api/webhooks/twilio` and EVERY
  // inbound message 403s.
  const signedUrl = `${appBaseUrl()}/api/webhooks/twilio`;

  const channel = activeChannel();

  if (!channel.verifySignature(signedUrl, params, signature)) {
    // Log both URLs: a mismatch here (trailing slash, http/https, wrong host)
    // silently drops every inbound message, so make it diagnosable in one look.
    console.warn('twilio webhook: signature verification failed', {
      signedUrl,
      requestUrl: request.url,
    });
    return new NextResponse('Forbidden', { status: 403 });
  }

  try {
    const inbound = channel.parseInbound(params);
    // Fire the full inbound pipeline (persist, capture media, hand off to the
    // orchestrator). handleInbound never throws — unknown senders get a
    // signup-link reply and return brandId:null — but we still guard the call in case of
    // an unexpected downstream failure, since Twilio must get a fast, cheap
    // response regardless.
    // `defer` hands follow-up work (the onboarding plan SMS) to Next's after()
    // so it survives the response. Without it the gateway detaches a bare
    // promise, Vercel freezes the isolate on 204, and that SMS never sends.
    await handleInbound(inbound, { defer: (task) => after(task) });
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
