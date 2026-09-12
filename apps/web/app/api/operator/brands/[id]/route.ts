export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import { deleteUnownedBrand, type DeleteBrandResult } from '@/lib/data/brands';

/** Map a data-layer refusal to an HTTP status + message. */
function fail(result: Extract<DeleteBrandResult, { ok: false }>): NextResponse {
  const map: Record<typeof result.error, { status: number; message: string }> = {
    not_found: { status: 404, message: 'Brand not found.' },
    has_owner: {
      status: 400,
      message: 'This brand is attached to a user. Delete the user instead.',
    },
  };
  const { status, message } = map[result.error];
  return NextResponse.json({ error: result.error, message }, { status });
}

/**
 * Permanently delete an unowned brand. Admin-only. Owned brands must be removed
 * by deleting their user (hard delete cascades).
 */
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!user.is_admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await context.params;
  const result = await deleteUnownedBrand(id);
  if (!result.ok) return fail(result);
  return NextResponse.json({ ok: true });
}
