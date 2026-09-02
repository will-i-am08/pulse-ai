'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { brandVoiceProfileSchema } from '@pulse/shared';
import { updateBrandVoiceProfile } from '@/lib/data/brands';

function lines(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function updateBrandVoiceAction(formData: FormData): Promise<void> {
  const brandId = String(formData.get('brandId') ?? '');
  if (!brandId) throw new Error('updateBrandVoiceAction: missing brandId');

  const raw = {
    tone: lines(formData.get('tone')),
    dos: lines(formData.get('dos')),
    donts: lines(formData.get('donts')),
    example_captions: lines(formData.get('example_captions')),
    banned_words: lines(formData.get('banned_words')),
    emoji_policy: String(formData.get('emoji_policy') ?? 'sparing'),
    hashtag_policy: String(formData.get('hashtag_policy') ?? ''),
    notes: lines(formData.get('notes')),
  };

  // Validate before persisting — this is the one source of truth for shape.
  const profile = brandVoiceProfileSchema.parse(raw);

  await updateBrandVoiceProfile(brandId, profile);
  redirect(`/app/brands/${brandId}`);
}
