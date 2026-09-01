import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBrand } from '@/lib/data/brands';
import { updateBrandVoiceAction } from '@/lib/actions/voice';

export default async function BrandVoicePage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const brand = await getBrand(brandId);
  if (!brand) notFound();

  const voice = brand.brand_voice_profile;

  return (
    <section>
      <div className="page-header">
        <div>
          <h1>{brand.name}</h1>
          <p className="meta">Voice profile</p>
        </div>
        <Link href={`/brands/${brand.id}`}>Back to approvals</Link>
      </div>

      <form action={updateBrandVoiceAction} className="form">
        <input type="hidden" name="brandId" value={brand.id} />

        <label>
          Tone
          <textarea name="tone" rows={3} defaultValue={voice.tone.join('\n')} />
        </label>
        <label>
          Dos
          <textarea name="dos" rows={4} defaultValue={voice.dos.join('\n')} />
        </label>
        <label>
          Don&apos;ts
          <textarea name="donts" rows={4} defaultValue={voice.donts.join('\n')} />
        </label>
        <label>
          Example captions
          <textarea name="example_captions" rows={5} defaultValue={voice.example_captions.join('\n')} />
        </label>
        <label>
          Banned words
          <textarea name="banned_words" rows={3} defaultValue={voice.banned_words.join('\n')} />
        </label>
        <label>
          Emoji policy
          <select name="emoji_policy" defaultValue={voice.emoji_policy}>
            <option value="none">None</option>
            <option value="sparing">Sparing</option>
            <option value="liberal">Liberal</option>
          </select>
        </label>
        <label>
          Hashtag policy
          <input name="hashtag_policy" defaultValue={voice.hashtag_policy} />
        </label>
        <label>
          Learned notes
          <textarea name="notes" rows={4} defaultValue={voice.notes.join('\n')} />
        </label>

        <button type="submit" className="btn-primary">
          Save voice profile
        </button>
      </form>
    </section>
  );
}
