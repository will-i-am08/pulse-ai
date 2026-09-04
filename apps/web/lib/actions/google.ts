'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { query, queryOne, decryptJson, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { refreshAccessToken, listLocations } from '@/lib/google/oauth';

async function ownerBrand(userId: string): Promise<Brand | null> {
  return queryOne<Brand>('select * from brands where owner_user_id = $1 order by created_at asc limit 1', [userId]);
}

/** Finalise the Google connection: store the chosen Business Profile location. */
export async function selectGbpLocationAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brand = await ownerBrand(user!.id);
  if (!brand) redirect('/app?google=nobrand');
  if (!brand!.google_tokens_encrypted) redirect('/app?google=expired');

  const locationName = String(formData.get('location') ?? '').trim();
  if (!locationName) redirect('/app/connect/google/choose?error=noloc');

  const { refresh_token } = decryptJson<{ refresh_token: string }>(brand!.google_tokens_encrypted);
  const accessToken = await refreshAccessToken(refresh_token);
  const locations = await listLocations(accessToken);
  const chosen = locations.find((l) => l.name === locationName);
  if (!chosen) redirect('/app/connect/google/choose?error=noloc');

  await query(
    `update brands set gbp_account = $1, gbp_location_id = $2, gbp_location_name = $3, google_connected_at = now()
     where id = $4`,
    [chosen!.account, chosen!.name, chosen!.title, brand!.id],
  );
  redirect('/app?google=success');
}
