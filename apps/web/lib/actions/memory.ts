'use server';
import 'server-only';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeBrandVoiceProfile, queryOne, type Brand } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { updateBrandVoiceProfile } from '@/lib/data/brands';

/**
 * Save the free-text "memory.md" — the rolling learned notes Kip keeps about a
 * brand. Stored in brand_voice_profile.notes (one note per line), the same
 * field the correction pipeline appends to.
 */
export async function updateMemoryNotesAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');

  const brand = await queryOne<Brand>(
    'select * from brands where owner_user_id = $1 order by created_at asc limit 1',
    [user!.id],
  );
  if (!brand) redirect('/app');

  const notes = String(formData.get('body') ?? '')
    .split('\n')
    .map((s) => s.replace(/^-\s*/, '').trim())
    .filter(Boolean);

  const voice = normalizeBrandVoiceProfile(brand!.brand_voice_profile);
  await updateBrandVoiceProfile(brand!.id, { ...voice, notes });
  revalidatePath('/app/memory');
  redirect('/app/memory?file=memory.md&saved=1');
}
