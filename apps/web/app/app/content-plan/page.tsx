import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { queryOne, type Brand, type ContentPlan } from '@pulse/shared';
import { listBrandsForOwner } from '@/lib/data/brands';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your content plan | Kip' };

export default async function ContentPlanPage() {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brands = await listBrandsForOwner(user!.id);
  const brand = brands[0] as Brand | undefined;
  if (!brand) redirect('/app');

  const row = await queryOne<ContentPlan>(
    `select * from content_plans where brand_id = $1 and plan is not null
      order by created_at desc limit 1`,
    [brand.id],
  );
  const plan = row?.plan ?? null;

  const card: React.CSSProperties = {
    border: '1px solid var(--border, #e2e2e8)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  };

  return (
    <section>
      <div className="page-header">
        <h1>Your content plan</h1>
      </div>

      {!plan ? (
        <div className="card">
          <p style={{ margin: 0, color: 'var(--muted, #667)' }}>
            Your tailored plan isn’t ready yet. I’m still studying your niche. It’ll arrive in your chat shortly.
          </p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <p style={{ marginTop: 0, fontSize: 16, fontWeight: 600 }}>{plan.summary}</p>
            {row?.status === 'accepted' ? (
              <p style={{ margin: 0, color: '#1e7e46' }}>✓ Active. Your pillars and schedule are set to this.</p>
            ) : (
              <p style={{ margin: 0, color: 'var(--muted, #667)' }}>
                Reply <strong>“yes”</strong> in your chat to set this up, or tell me what to tweak.
              </p>
            )}
          </div>

          <h2 style={{ fontSize: 18, margin: '18px 0 10px' }}>Content pillars</h2>
          {plan.pillars.map((p) => (
            <div key={p.key} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <strong>{p.name}</strong>
                <span style={{ fontSize: 13, color: 'var(--muted, #667)' }}>
                  {p.posts_per_week}/wk · {p.format_bias ?? 'carousel'}
                </span>
              </div>
              <p style={{ margin: '6px 0 0', color: 'var(--muted, #667)' }}>{p.description}</p>
            </div>
          ))}

          <div className="card" style={{ marginTop: 16 }}>
            <p style={{ margin: '0 0 8px' }}>
              <strong>Format mix:</strong> {plan.format_mix}
            </p>
            <p style={{ margin: 0 }}>
              <strong>Best times:</strong> {plan.best_times}
            </p>
          </div>

          {plan.starter_ideas?.length ? (
            <>
              <h2 style={{ fontSize: 18, margin: '18px 0 10px' }}>Starter ideas</h2>
              <div className="card">
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {plan.starter_ideas.map((idea, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      {idea}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
