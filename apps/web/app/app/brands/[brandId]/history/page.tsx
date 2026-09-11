import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBrandForUser } from '@/lib/data/brands';
import { currentUser } from '@/lib/auth/current-user';
import { listPostsByStatus } from '@/lib/data/posts';
import { latestLogForPost } from '@/lib/data/approval-log';

export default async function PostHistoryPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const user = await currentUser();
  if (!user) notFound();
  const brand = await getBrandForUser(brandId, user);
  if (!brand) notFound();

  const posts = await listPostsByStatus(brandId, ['published', 'failed']);
  posts.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  const withLogs = await Promise.all(
    posts.map(async (post) => ({
      post,
      publishLog: post.status === 'published' ? await latestLogForPost(post.id, 'published') : null,
    }))
  );

  return (
    <section className="stage">
      <div className="page">
      <div className="page-header">
        <div>
          <h1>{brand.name}</h1>
          <p className="meta">Post history</p>
        </div>
        <Link href={`/app/brands/${brand.id}`}>Back to approvals</Link>
      </div>

      {withLogs.length === 0 ? (
        <p className="empty">No published or failed posts yet.</p>
      ) : (
        <ul className="history-list">
          {withLogs.map(({ post, publishLog }) => {
            const after =
              publishLog && typeof publishLog.after === 'object' && publishLog.after !== null
                ? (publishLog.after as Record<string, unknown>)
                : null;
            const permalink = after && typeof after.permalink === 'string' ? after.permalink : null;
            const engagementEntries = Object.entries(post.engagement ?? {});

            return (
              <li key={post.id} className="history-card">
                <div className="history-head">
                  <span className={`badge badge-${post.status}`}>{post.status}</span>
                  <span className="meta">{post.platform}</span>
                  {post.published_at && (
                    <span className="meta">{new Date(post.published_at).toLocaleString('en-AU')}</span>
                  )}
                </div>

                <p className="caption">{post.caption}</p>

                {post.status === 'published' && (
                  <p className="meta">
                    {permalink ? (
                      <a href={permalink} target="_blank" rel="noreferrer">
                        View live post
                      </a>
                    ) : post.external_post_id ? (
                      <>External ID: {post.external_post_id}</>
                    ) : (
                      'No permalink recorded'
                    )}
                    {' · Engagement: '}
                    {engagementEntries.length > 0
                      ? engagementEntries.map(([k, v]) => `${k}: ${v}`).join(', ')
                      : 'no data yet'}
                  </p>
                )}

                {post.status === 'failed' && (
                  <p className="error">
                    {post.last_error ?? 'Unknown error'} (retry {post.retry_count})
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </section>
  );
}
