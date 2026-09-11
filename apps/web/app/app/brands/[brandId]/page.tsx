import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBrandForUser } from '@/lib/data/brands';
import { currentUser } from '@/lib/auth/current-user';
import { listPostsByStatus } from '@/lib/data/posts';
import { getMediaPreviews } from '@/lib/data/media';
import { approvePostAction, editAndApprovePostAction, rejectPostAction } from '@/lib/actions/approvals';
import { dismissReplyAction, sendReplyAction } from '@/lib/actions/replies';
import { listPendingReplies } from '@/lib/data/interactions';

export default async function BrandDetailPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const user = await currentUser();
  if (!user) notFound();
  const brand = await getBrandForUser(brandId, user);
  if (!brand) notFound();

  const pending = await listPostsByStatus(brandId, ['pending_approval']);
  const pendingWithMedia = await Promise.all(
    pending.map(async (post) => ({ post, media: await getMediaPreviews(post.media_ids) }))
  );
  const pendingReplies = await listPendingReplies(brandId);

  return (
    <section className="stage">
      <div className="page">
      <div className="page-header">
        <div>
          <h1>{brand.name}</h1>
          <p className="meta">
            {brand.client_phone} · {brand.approver} approves ·{' '}
            <span className={`badge badge-${brand.status}`}>{brand.status}</span>
          </p>
        </div>
        <nav className="tabs">
          <Link href={`/app/brands/${brand.id}/voice`}>Voice profile</Link>
          <Link href={`/app/brands/${brand.id}/history`}>Post history</Link>
        </nav>
      </div>

      <h2>Pending approvals</h2>
      {pendingWithMedia.length === 0 ? (
        <p className="empty">Nothing waiting on you right now.</p>
      ) : (
        <ul className="approval-list">
          {pendingWithMedia.map(({ post, media }) => {
            const defaultSchedule = post.scheduled_at ? post.scheduled_at.slice(0, 16) : '';
            return (
              <li key={post.id} className="approval-card">
                <div className="media-row">
                  {media.length === 0 && <span className="hint">No media attached</span>}
                  {media.map((m) =>
                    m.url ? (
                      m.kind === 'video' ? (
                        <video key={m.id} src={m.url} controls className="media-thumb" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived; no benefit from next/image optimisation here
                        <img key={m.id} src={m.url} alt="" className="media-thumb" />
                      )
                    ) : (
                      <span key={m.id} className="hint">
                        Preview unavailable
                      </span>
                    )
                  )}
                </div>

                <form className="approval-form">
                  <input type="hidden" name="postId" value={post.id} />
                  <input type="hidden" name="brandId" value={brand.id} />

                  <label>
                    Caption
                    <textarea name="caption" rows={4} defaultValue={post.caption ?? ''} />
                  </label>
                  <label>
                    Scheduled for
                    <input type="datetime-local" name="scheduledAt" defaultValue={defaultSchedule} />
                  </label>
                  <label>
                    Rejection note (optional)
                    <input type="text" name="note" placeholder="Why are you rejecting this?" />
                  </label>

                  <div className="approval-actions">
                    <button type="submit" formAction={approvePostAction} className="btn-primary">
                      Approve
                    </button>
                    <button type="submit" formAction={editAndApprovePostAction} className="btn-secondary">
                      Save edit &amp; approve
                    </button>
                    <button type="submit" formAction={rejectPostAction} className="btn-danger">
                      Reject
                    </button>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Replies awaiting you</h2>
      {pendingReplies.length === 0 ? (
        <p className="empty">No comments, messages, or reviews need an answer.</p>
      ) : (
        <ul className="approval-list">
          {pendingReplies.map(({ interaction, draftBody }) => (
            <li key={interaction.id} className="approval-card">
              <p className="meta">
                <span className={`badge badge-${interaction.status}`}>{interaction.status}</span>{' '}
                {interaction.kind} on {interaction.platform}
                {interaction.author ? ` from ${interaction.author}` : ''} ·{' '}
                {new Date(interaction.created_at).toLocaleString('en-AU')}
              </p>
              {interaction.text && <blockquote>{interaction.text}</blockquote>}

              <form className="approval-form">
                <input type="hidden" name="interactionId" value={interaction.id} />
                <input type="hidden" name="brandId" value={brand.id} />

                <label>
                  {draftBody ? 'Suggested reply (edit as you like)' : 'Your reply'}
                  <textarea name="body" rows={3} defaultValue={draftBody ?? ''} />
                </label>

                <div className="approval-actions">
                  <button type="submit" formAction={sendReplyAction} className="btn-primary">
                    Send reply
                  </button>
                  <button type="submit" formAction={dismissReplyAction} className="btn-danger">
                    Dismiss
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
      </div>
    </section>
  );
}
