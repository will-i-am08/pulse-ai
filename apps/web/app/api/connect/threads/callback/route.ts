import { NextResponse, type NextRequest } from 'next/server';
import { query, queryOne, encryptJson, type Brand } from '@pulse/shared';
import { queueVoiceAnalysis } from '@pulse/orchestrator';
import { currentUser } from '@/lib/auth/current-user';
import { verifyState } from '@/lib/meta/state';
import { exchangeCode, exchangeForLongLived, getMe } from '@/lib/threads/oauth';

export const dynamic = 'force-dynamic';

function back(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, process.env.APP_BASE_URL ?? 'http://localhost:3000'));
}

/** Threads redirects here with ?code=&state= (or ?error=). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  if (params.get('error')) return back('/app?threads=denied');

  const userId = verifyState(params.get('state'));
  const code = params.get('code');
  if (!userId || !code) return back('/app?threads=invalid');

  const session = await currentUser();
  if (!session || session.id !== userId) return back('/app?threads=invalid');

  const brand = await queryOne<Brand>(
    'select id from brands where owner_user_id = $1 order by created_at asc limit 1',
    [userId],
  );
  if (!brand) return back('/app?threads=nobrand');

  try {
    const short = await exchangeCode(code);
    const long = await exchangeForLongLived(short.access_token);
    const me = await getMe(long.access_token);
    const expiresAt = Date.now() + long.expires_in * 1000;
    // Store the id from GET /me, NOT short.user_id — the token-exchange user_id is a
    // different (app-scoped) id and the publish endpoint (/{id}/threads) rejects it.
    await query('update brands set threads_user_id = $1, threads_username = $2, threads_tokens_encrypted = $3 where id = $4', [
      me.id || short.user_id,
      me.username,
      encryptJson({ access_token: long.access_token, expires_at: expiresAt }),
      brand.id,
    ]);
    // Threads history is now readable — (re)run the voice agent to fold it in.
    await queueVoiceAnalysis(brand.id);
    return back('/app?threads=success');
  } catch (err) {
    console.error('threads callback failed', err);
    return back('/app?threads=failed');
  }
}
