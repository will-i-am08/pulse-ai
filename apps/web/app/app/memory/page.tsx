import Link from 'next/link';
import { redirect } from 'next/navigation';
import { normalizeBrandVoiceProfile, type Brand, type BrandVoiceProfile } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { updateMemoryNotesAction } from '@/lib/actions/memory';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Memory | Kip' };

type FileName = 'memory.md' | 'voice.md' | 'brand.md';
const FILES: FileName[] = ['memory.md', 'voice.md', 'brand.md'];

function bullets(label: string, items: string[]): string {
  if (!items.length) return '';
  return `${label}:\n${items.map((i) => `  - ${i}`).join('\n')}\n`;
}

function voiceMd(v: BrandVoiceProfile): string {
  return (
    bullets('tone', v.tone) +
    bullets('dos', v.dos) +
    bullets('donts', v.donts) +
    `emoji: ${v.emoji_policy}\n` +
    (v.hashtag_policy ? `hashtags: ${v.hashtag_policy}\n` : '') +
    bullets('example captions', v.example_captions) +
    bullets('banned words', v.banned_words)
  ).trim() || 'No voice profile saved yet. Kip learns your voice from your edits and notes.';
}

function memoryMd(v: BrandVoiceProfile): string {
  if (v.notes.length) return v.notes.map((n) => `- ${n}`).join('\n');
  return 'Nothing learned yet. Every time you edit a caption, Kip notes why here.';
}

function brandMd(b: Brand): string {
  return [b.name, b.ig_username ? `Instagram @${b.ig_username}` : null, `Phone ${b.client_phone}`]
    .filter(Boolean)
    .join('\n');
}

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ file?: string; saved?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];
  if (!brand) redirect('/app');

  const { file, saved } = await searchParams;
  const active: FileName = (FILES as string[]).includes(file ?? '') ? (file as FileName) : 'memory.md';
  // `{}` from Postgres is truthy — always normalize so .notes/.tone never crash.
  const voice = normalizeBrandVoiceProfile(brand.brand_voice_profile);

  const body =
    active === 'voice.md' ? voiceMd(voice) : active === 'brand.md' ? brandMd(brand) : memoryMd(voice);

  return (
    <section className="stage">
      <div className="page">
        <h1 className="page-h1">Memory</h1>
        <p className="lead">Everything Kip knows about your brand, in plain files.</p>

        <div className="files">
          <nav>
            {FILES.map((f) => (
              <Link key={f} href={`/app/memory?file=${f}`} className={active === f ? 'on' : ''}>
                {f}
              </Link>
            ))}
          </nav>
          <div>
            {active === 'memory.md' ? (
              <form action={updateMemoryNotesAction}>
                {saved && <p className="banner ok">Saved. Kip will use this from now on.</p>}
                <textarea
                  name="body"
                  defaultValue={voice.notes.length ? voice.notes.map((n) => `- ${n}`).join('\n') : ''}
                  placeholder="One note per line, e.g.&#10;- Almond croissant is the hero pastry&#10;- Never post before 7am"
                  style={{ minHeight: 280, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14 }}
                />
                <p style={{ marginTop: 12 }}>
                  <button className="pill-dark" type="submit">Save file</button>
                </p>
              </form>
            ) : (
              <>
                <div className="file" style={{ whiteSpace: 'pre-wrap' }}>{body}</div>
                {active === 'voice.md' ? (
                  <p style={{ marginTop: 14 }}>
                    <Link className="pill-dark" href={`/app/brands/${brand.id}/voice`}>
                      Edit voice profile
                    </Link>
                  </p>
                ) : (
                  <p className="note-card" style={{ marginTop: 14 }}>
                    Brand details come from Connections and signup. Update your number in Connections.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
