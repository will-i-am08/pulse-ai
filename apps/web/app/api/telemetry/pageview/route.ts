export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import { recordPageView } from '@/lib/metrics/visits';

/** Lightweight pageview beacon for first-party visit metrics. */
export async function POST(request: NextRequest) {
  let body: { path?: string; sessionId?: string };
  try {
    body = (await request.json()) as { path?: string; sessionId?: string };
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const path = typeof body.path === 'string' ? body.path : '';
  if (!path.startsWith('/')) return NextResponse.json({ error: 'bad_path' }, { status: 400 });
  if (path.startsWith('/api/') || path.startsWith('/_next/') || path.includes('.')) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const user = await currentUser().catch(() => null);
  await recordPageView({
    path,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 80) : null,
    userId: user?.id ?? null,
  });
  return NextResponse.json({ ok: true });
}
