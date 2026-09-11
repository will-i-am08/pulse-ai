export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { publicMediaUrl } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { listRecentMessages } from '@/lib/data/messages';
import type { ThreadMessageDto } from '@/lib/thread';

export type { ThreadMessageDto };

/**
 * Authenticated owner thread snapshot. Used by the dashboard LiveThread
 * client to poll for new SMS/web messages without a full page reload.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (user.is_admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];
  if (!brand) {
    return NextResponse.json({ brandId: null, messages: [] as ThreadMessageDto[] });
  }

  const rows = await listRecentMessages(brand.id, 40);
  const messages: ThreadMessageDto[] = rows.map((m) => ({
    id: m.id,
    direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
    body: m.body,
    mediaUrl: m.media_ids[0] ? publicMediaUrl(m.media_ids[0]) : null,
    createdAt: m.created_at,
  }));

  return NextResponse.json({
    brandId: brand.id,
    messages,
  });
}
