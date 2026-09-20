import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { getUnlockStatus } from '@/lib/data/operator-unlock';
import { getUserById } from '@/lib/data/users';
import { getBrand } from '@/lib/data/brands';
import OperatorUserProfile from './OperatorUserProfile';
import OperatorBillingPanel from './OperatorBillingPanel';

export const dynamic = 'force-dynamic';

export default async function OperatorUserProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ billing?: string; detail?: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (!me.is_admin) redirect('/app');

  const { id } = await params;
  const user = await getUserById(id);
  if (!user) notFound();

  const unlock = await getUnlockStatus(me.id, id);
  const { billing, detail } = await searchParams;
  const brand = user.brand_id ? await getBrand(user.brand_id) : null;

  return (
    <section className="stage">
      <div className="page">
        <OperatorUserProfile
          user={user}
          currentUserId={me.id}
          initialUnlocked={unlock.unlocked}
          initialExpiresAt={unlock.expiresAt}
        />
        {brand && (
          <OperatorBillingPanel
            brand={brand}
            ownerUserId={user.id}
            notice={
              billing === 'ok' || billing === 'error'
                ? { ok: billing === 'ok', detail }
                : undefined
            }
          />
        )}
      </div>
    </section>
  );
}
