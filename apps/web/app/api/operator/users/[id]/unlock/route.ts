export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth/current-user';
import {
  clearUnlock,
  getUnlockStatus,
  requestOperatorUnlock,
  verifyOperatorUnlock,
} from '@/lib/data/operator-unlock';
import { updateUserPrivateFields } from '@/lib/data/users';

async function requireAdmin() {
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!user.is_admin) return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  return { user };
}

/** GET unlock status for this operator + target user. */
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth && auth.error) return auth.error;
  const { id } = await context.params;
  const status = await getUnlockStatus(auth.user!.id, id);
  return NextResponse.json(status);
}

/**
 * POST body:
 * - { action: 'request' } — SMS code to target phone
 * - { action: 'verify', code } — open 1h unlock
 * - { action: 'lock' } — clear unlock early
 * - { action: 'save', name, email, phone } — update private fields (requires unlock)
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ('error' in auth && auth.error) return auth.error;
  const operator = auth.user!;
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'bad_json', message: 'Invalid JSON.' }, { status: 400 });
  }

  const action = String(body.action ?? '');

  if (action === 'request') {
    const result = await requestOperatorUnlock(id);
    if (!result.ok) {
      const map = {
        not_found: { status: 404, message: 'User not found.' },
        no_phone: { status: 400, message: 'This user has no phone number on file.' },
        throttled: { status: 429, message: 'Wait a few seconds before requesting another code.' },
      } as const;
      const m = map[result.error];
      return NextResponse.json({ error: result.error, message: m.message }, { status: m.status });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'verify') {
    const code = String(body.code ?? '');
    const result = await verifyOperatorUnlock(operator.id, id, code);
    if (!result.ok) {
      const map = {
        not_found: { status: 404, message: 'User not found.' },
        no_phone: { status: 400, message: 'This user has no phone number on file.' },
        invalid: { status: 400, message: 'Incorrect code.' },
        expired: { status: 400, message: 'Code expired — request a new one.' },
        locked: { status: 400, message: 'Too many attempts — request a new code.' },
      } as const;
      const m = map[result.error];
      return NextResponse.json({ error: result.error, message: m.message }, { status: m.status });
    }
    return NextResponse.json({ ok: true, expiresAt: result.expiresAt });
  }

  if (action === 'lock') {
    await clearUnlock(operator.id, id);
    return NextResponse.json({ ok: true });
  }

  if (action === 'save') {
    const unlocked = await getUnlockStatus(operator.id, id);
    if (!unlocked.unlocked) {
      return NextResponse.json(
        { error: 'locked', message: 'Private fields are locked. Request and enter an unlock code first.' },
        { status: 403 },
      );
    }
    const name = body.name === undefined || body.name === '' ? null : String(body.name).trim();
    const email = body.email === undefined || body.email === '' ? null : String(body.email).trim().toLowerCase();
    const phone = body.phone === undefined || body.phone === '' ? null : String(body.phone).trim();
    const result = await updateUserPrivateFields(id, { name, email, phone });
    if (!result.ok) {
      const map = {
        not_found: { status: 404, message: 'User not found.' },
        email_taken: { status: 409, message: 'That email is already in use.' },
        phone_taken: { status: 409, message: 'That phone is already in use.' },
      } as const;
      const m = map[result.error];
      return NextResponse.json({ error: result.error, message: m.message }, { status: m.status });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'bad_action', message: 'Unknown action.' }, { status: 400 });
}
