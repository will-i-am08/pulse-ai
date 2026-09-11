export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import {
  hardDeleteUser,
  restoreUser,
  softDeleteUser,
  type Actor,
  type DeleteUserResult,
} from '@/lib/data/users';

/** The signed-in admin as an audit-log actor. */
function actorFor(user: { id: string; name: string | null; email: string | null; phone: string | null }): Actor {
  return { id: user.id, label: user.name || user.email || user.phone || user.id.slice(0, 8) };
}

/** Map a data-layer refusal to an HTTP status + message. */
function fail(result: Extract<DeleteUserResult, { ok: false }>): NextResponse {
  const map: Record<typeof result.error, { status: number; message: string }> = {
    not_found: { status: 404, message: 'User not found.' },
    self: { status: 400, message: "You can't delete your own account." },
    last_admin: { status: 400, message: "Can't remove the last remaining admin." },
    already_deleted: { status: 409, message: 'User is already deactivated.' },
  };
  const { status, message } = map[result.error];
  return NextResponse.json({ error: result.error, message }, { status });
}

/**
 * Delete a user. `?mode=soft` (default) deactivates reversibly; `?mode=hard`
 * permanently erases the account and cascades to their brands. Admin-only.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await context.params;
  const mode = new URL(request.url).searchParams.get('mode') === 'hard' ? 'hard' : 'soft';

  const actor = actorFor(user);
  const result =
    mode === 'hard' ? await hardDeleteUser(id, actor) : await softDeleteUser(id, actor);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true, mode });
}

/** Restore a soft-deleted user. Admin-only. */
export async function PATCH(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await context.params;
  const result = await restoreUser(id, actorFor(user));
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true });
}
