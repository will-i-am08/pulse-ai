import Link from 'next/link';
import { redirect } from 'next/navigation';
import { emptyBrandVoiceProfile, type Brand, type BrandVoiceProfile } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';

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

export default async function MemoryPage({ searchParams }: { searchParams: Promise<{ file?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];
  if (!brand) redirect('/app');

  const { file } = await searchParams;
  const active: FileName = (FILES as string[]).includes(file ?? '') ? (file as FileName) : 'memory.md';
  const voice = brand.brand_voice_profile ?? emptyBrandVoiceProfile();

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
            <div className="file" style={{ whiteSpace: 'pre-wrap' }}>{body}</div>
            {active === 'voice.md' ? (
              <p style={{ marginTop: 14 }}>
                <Link className="pill-dark" href={`/app/brands/${brand.id}/voice`}>
                  Edit voice profile
                </Link>
              </p>
            ) : (
              <p className="note-card" style={{ marginTop: 14 }}>
                {active === 'brand.md'
                  ? 'Brand details come from Connections and signup. Update your number in Connections.'
                  : 'Kip writes to memory as it learns from your edits. Direct editing here is coming — for now, correct a caption and Kip remembers why.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
