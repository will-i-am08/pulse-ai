import 'server-only';
import { query } from '@pulse/shared';
import styles from './feed.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feed — Pulse (demo)' };

type Row = {
  id: string;
  caption: string | null;
  platform: string;
  published_at: string | null;
  media_ids: string[];
  brand_name: string;
};

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

export default async function FeedPage() {
  const posts = await query<Row>(
    `select p.id, p.caption, p.platform, p.published_at, p.media_ids, b.name as brand_name
     from posts p join brands b on b.id = p.brand_id
     where p.status = 'published'
     order by p.published_at desc nulls last, p.created_at desc
     limit 50`,
  );

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <span className={styles.logo}>pulse<span className={styles.logoAccent}>feed</span></span>
        <span className={styles.demoTag}>Demo feed · not a real social network</span>
      </header>

      <div className={styles.column}>
        {posts.length === 0 && (
          <p className={styles.empty}>
            Nothing here yet. Send the bot a photo, approve the caption, and it lands here.
          </p>
        )}
        {posts.map((p) => (
          <article key={p.id} className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.avatar}>{(p.brand_name || '?').charAt(0).toUpperCase()}</span>
              <div>
                <div className={styles.name}>{p.brand_name}</div>
                <div className={styles.meta}>
                  {fmt(p.published_at)} · <span className={styles.platform}>{p.platform}</span>
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
