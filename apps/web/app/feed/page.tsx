import 'server-only';
import { query, platformLabel } from '@pulse/shared';
import { KipMark } from '../components/KipMark';
import styles from './feed.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feed | Kip (demo)' };

type Row = {
  id: string;
  caption: string | null;
  platform: string;
  published_at: string | null;
  media_ids: string[];
  brand_name: string;
};

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'x', label: 'X' },
  { key: 'threads', label: 'Threads' },
] as const;

function fmt(iso: string | null): string {
  if (!iso) return 'just now';
  try {
    return new Date(iso.replace(' ', 'T')).toLocaleString('en-AU', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>;
}) {
  const sp = await searchParams;
  const platform = (sp.platform ?? '').toLowerCase();
  const filtered = FILTERS.some((f) => f.key && f.key === platform);

  const posts = await query<Row>(
    filtered
      ? `select p.id, p.caption, p.platform, p.published_at, p.media_ids, b.name as brand_name
         from posts p join brands b on b.id = p.brand_id
         where p.status = 'published' and p.platform = $1
         order by p.published_at desc nulls last, p.created_at desc
         limit 50`
      : `select p.id, p.caption, p.platform, p.published_at, p.media_ids, b.name as brand_name
         from posts p join brands b on b.id = p.brand_id
         where p.status = 'published'
         order by p.published_at desc nulls last, p.created_at desc
         limit 50`,
    filtered ? [platform] : [],
  );

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.logo}>
          <KipMark size={28} />
          Kip<span className={styles.logoAccent}>feed</span>
        </span>
        <span className={styles.demoTag}>Demo feed · not a real social network</span>
      </header>

      <nav className={styles.filters} aria-label="Filter by platform">
        {FILTERS.map((f) => {
          const href = f.key ? `/feed?platform=${f.key}` : '/feed';
          const active = f.key ? platform === f.key : !filtered;
          return (
            <a key={f.label} href={href} className={active ? styles.filterActive : styles.filter}>
              {f.label}
            </a>
          );
        })}
      </nav>

      <div className={styles.column}>
        {posts.length === 0 && (
          <p className={styles.empty}>
            {filtered
              ? `No mock ${platformLabel(platform)} posts yet. Text Kip a photo, say "${platform === 'x' ? 'X only' : platform === 'threads' ? 'Threads only' : platformLabel(platform)}", then "yes".`
              : 'Nothing here yet. Send the bot a photo, approve the caption, and it lands here.'}
          </p>
        )}
        {posts.map((p) => (
          <article key={p.id} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.avatar}>{(p.brand_name || '?').charAt(0).toUpperCase()}</span>
              <div>
                <div className={styles.name}>{p.brand_name}</div>
                <div className={styles.meta}>
                  {fmt(p.published_at)} · <span className={styles.platform}>{platformLabel(p.platform)}</span>
                </div>
              </div>
            </div>
            {p.caption && <p className={styles.caption}>{p.caption}</p>}
            {p.media_ids[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.media} src={`/api/media/${p.media_ids[0]}`} alt="Post media" />
            )}
            <div className={styles.actions}>
              <span>👍 Like</span>
              <span>💬 Comment</span>
              <span>↗ Share</span>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
