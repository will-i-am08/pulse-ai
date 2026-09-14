export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import { runKickoffDrain } from '@pulse/orchestrator';
import { sendToBrand } from '@pulse/gateway';

/**
 * Manually drain Kip's self-kickoff queue (first batch, drafts, trend/competitor).
 * Admin-only — used when the Railway worker is behind and we need drafts now.
 * SMS fires as each draft finishes.
 */
export async function POST(_request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  try {
    const sent: { brandId: string; preview: string }[] = [];
    const results = await runKickoffDrain(3, {
      deliver: async (r) => {
        await sendToBrand(r.brandId, r.sms, r.mediaUrls?.length ? r.mediaUrls : r.mediaUrl ? [r.mediaUrl] : undefined);
        sent.push({ brandId: r.brandId, preview: r.sms.slice(0, 120) });
      },
    });
    return NextResponse.json({ ok: true, drained: results.length, sent });
  } catch (err) {
    console.error('[operator] kickoff drain failed', err);
    return NextResponse.json(
      { error: 'drain_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
