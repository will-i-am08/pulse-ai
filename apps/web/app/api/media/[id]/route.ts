// Public media route — no auth (see middleware.ts's isPublicPath). This is
// the URL Meta's Graph API fetches as `image_url`/`video_url` when publishing,
// and what the dashboard's approval-card previews point at.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getMedia } from '@pulse/shared';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  // Media ids are uuids; anything else can't exist — 404 rather than a DB error.
  if (!UUID_RE.test(id)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const media = await getMedia(id);
  if (!media) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(new Uint8Array(media.bytes), {
    status: 200,
    headers: {
      'Content-Type': media.contentType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
