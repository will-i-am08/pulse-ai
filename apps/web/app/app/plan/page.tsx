import Link from 'next/link';
import { redirect } from 'next/navigation';
import { publicMediaUrl } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { ownerBrandId, listPlanPosts, listPillars, type PlanPost } from '@/lib/data/plan';
import { reschedulePostAction, removePostAction, setPillarAction } from '@/lib/actions/plan';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content calendar | Kip' };

const PILLAR_COLORS: Record<string, string> = {
  behind_the_scenes: '#6366f1',
  product: '#ec4899',
  social_proof: '#10b981',
  educational: '#f59e0b',
  lifestyle: '#06b6d4',
};
const pillarColor = (key: string | null) => (key && PILLAR_COLORS[key]) || '#64748b';

type StatusStyle = { label: string; bg: string; fg: string };
const STATUS: Record<string, StatusStyle> = {
  pending_approval: { label: 'Needs a yes', bg: '#f3f3f4', fg: '#1d1d1f' },
  approved: { label: 'Approved', bg: '#eef1f5', fg: '#565f6b' },
  scheduled: { label: 'Autopilot', bg: '#eafaf0', fg: '#1a7f4e' },
  published: { label: 'Published', bg: '#eef1f5', fg: '#565f6b' },
};
const FALLBACK_STATUS: StatusStyle = { label: 'Scheduled', bg: '#eef1f5', fg: '#565f6b' };

function startOfWeek(base: Date, weekOffset: number): Date {
  const d = new Date(base);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day + weekOffset * 7);
  return d;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

function PostCard({ post }: { post: PlanPost }) {
  const st = STATUS[post.status] ?? FALLBACK_STATUS;
  const thumb = post.media_ids[0] ? publicMediaUrl(post.media_ids[0]) : null;
  const editable = post.status !== 'published';
  return (
    <div style={{ border: '1px solid var(--border,#e6e6ec)', borderLeft: `3px solid ${pillarColor(post.pillar_key)}`, borderRadius: 8, padding: 8, background: '#fff', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {thumb && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" width={44} height={44} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, flex: '0 0 auto' }} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
            <strong style={{ fontSize: 12 }}>{post.scheduled_at ? fmtTime(post.scheduled_at) : '-'}</strong>
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.label}</span>
          </div>
          <div style={{ color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
            {post.caption ?? '(no caption)'}
          </div>
          <div style={{ fontSize: 11, marginTop: 2 }}>
            {post.campaign_name ? (
              <span style={{ color: '#7c3aed' }}>🚀 {post.campaign_name}</span>
            ) : (
              <span style={{ color: pillarColor(post.pillar_key) }}>{post.pillar_name ?? 'Unsorted'}</span>
            )}
          </div>
        </div>
      </div>
      {editable && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <form action={reschedulePostAction} style={{ display: 'flex', gap: 4 }}>
            <input type="hidden" name="postId" value={post.id} />
            <input type="datetime-local" name="scheduledAt" defaultValue={post.scheduled_at ? toLocalInput(post.scheduled_at) : ''} style={{ fontSize: 11, padding: '2px 4px', border: '1px solid var(--border,#d9d9e0)', borderRadius: 6 }} />
            <button type="submit" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border,#d9d9e0)', background: '#f7f7fa', cursor: 'pointer' }}>Move</button>
          </form>
          <form action={removePostAction}>
            <input type="hidden" name="postId" value={post.id} />
            <button type="submit" style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, border: '1px solid #f2c4bd', background: '#fff', color: '#c0392b', cursor: 'pointer' }}>Remove</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brandId = await ownerBrandId(user.id);
  if (!brandId) {
    return (
      <section>
        <div className="page-header"><h1>Content calendar</h1></div>
        <p className="empty">Finish setting up your account first.</p>
      </section>
    );
  }

  const { w } = await searchParams;
  const weekOffset = Number(w ?? 0) || 0;
  const [posts, pillars] = await Promise.all([listPlanPosts(brandId), listPillars(brandId)]);

  const weekStart = startOfWeek(new Date(), weekOffset);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const dayFmt = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const today = new Date();

  return (
    <section>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1>Content calendar</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href={`/app/plan?w=${weekOffset - 1}`} className="btn-secondary" style={{ padding: '6px 12px', textDecoration: 'none' }}>← Prev</Link>
          {weekOffset !== 0 && <Link href="/app/plan" style={{ alignSelf: 'center' }}>This week</Link>}
          <Link href={`/app/plan?w=${weekOffset + 1}`} className="btn-secondary" style={{ padding: '6px 12px', textDecoration: 'none' }}>Next →</Link>
        </div>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(150px, 1fr))', gap: 8, minWidth: 900 }}>
          {days.map((day) => {
            const dayPosts = posts.filter((p) => p.scheduled_at && sameDay(new Date(p.scheduled_at), day));
            const isToday = sameDay(day, today);
            return (
              <div key={day.toISOString()} style={{ background: isToday ? '#fff' : '#f6f7f9', borderRadius: 10, padding: 8, minHeight: 120, border: isToday ? '1px solid #14171d' : '1px solid var(--line,#e4e8ee)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: isToday ? '#14171d' : '#565f6b', marginBottom: 8 }}>{dayFmt.format(day)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dayPosts.length === 0 ? (
                    <span style={{ color: '#aab', fontSize: 12 }}>-</span>
                  ) : (
                    dayPosts.map((p) => <PostCard key={p.id} post={p} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Content pillars & cadence</h2>
        <p style={{ color: 'var(--muted,#667)', marginTop: 0, fontSize: 14 }}>
          Set how often each type posts, and flip a pillar to autopilot to let it post itself (you still get a heads-up before each one).
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pillars.map((pl) => (
            <form key={pl.id} action={setPillarAction} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--border,#eee)', borderRadius: 8 }}>
              <input type="hidden" name="pillarId" value={pl.id} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: pillarColor(pl.key), flex: '0 0 auto' }} />
              <strong style={{ flex: '1 1 160px' }}>{pl.name}</strong>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="number" name="postsPerWeek" defaultValue={pl.posts_per_week} min={0} max={14} style={{ width: 52, padding: '4px 6px', borderRadius: 6, border: '1px solid var(--border,#d9d9e0)' }} />
                / week
              </label>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" name="autopilot" defaultChecked={pl.autopilot} /> Autopilot
              </label>
              <button type="submit" className="btn-primary" style={{ padding: '5px 12px' }}>Save</button>
            </form>
          ))}
        </div>
      </div>
    </section>
  );
}
