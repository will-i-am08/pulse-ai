// Public media route — no auth (see middleware.ts's isPublicPath). This is
// the URL Meta's Graph API fetches as `image_url`/`video_url` when publishing,
// and what the dashboard's approval-card previews point at.
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { getMedia } from '@pulse/shared';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

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
