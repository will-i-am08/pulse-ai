'use server';
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { query, queryOne, encryptJson, decryptJson, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { SOURCE_TOKEN_COOKIE } from '@/lib/google/sources';

const KINDS = new Set(['google_drive', 'google_photos']);

async function ownerBrand(userId: string): Promise<Brand | null> {
  return queryOne<Brand>('select * from brands where owner_user_id = $1 order by created_at asc limit 1', [userId]);
}

/** Finalise a content source: create the content_sources row with its own token. */
export async function selectSourceAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brand = await ownerBrand(user!.id);
  if (!brand) redirect('/app?source=nobrand');

  const jar = await cookies();
  const cookie = jar.get(SOURCE_TOKEN_COOKIE)?.value;
  if (!cookie) redirect('/app?source=expired');

  const raw = String(formData.get('source') ?? '').trim();
  const sep = raw.indexOf(':');
  const kind = sep > 0 ? raw.slice(0, sep) : '';
  const externalRef = sep > 0 ? raw.slice(sep + 1) : '';
  if (!KINDS.has(kind) || !externalRef) redirect('/app/connect/source/choose?error=nopick');

  const { refresh_token } = decryptJson<{ refresh_token: string }>(cookie!);

  // One source per (brand, kind, external_ref): if it already exists, just refresh its token.
  const existing = await queryOne<{ id: string }>(
    'select id from content_sources where brand_id = $1 and kind = $2 and external_ref = $3 limit 1',
    [brand!.id, kind, externalRef],
  );
  if (existing) {
    await query('update content_sources set encrypted_token = $1 where id = $2', [
      encryptJson({ refresh_token }),
      existing.id,
    ]);
  } else {
    await query(
      'insert into content_sources (brand_id, kind, external_ref, encrypted_token) values ($1, $2, $3, $4)',
      [brand!.id, kind, externalRef, encryptJson({ refresh_token })],
    );
  }

  jar.delete(SOURCE_TOKEN_COOKIE);
  redirect('/app?source=success');
}
