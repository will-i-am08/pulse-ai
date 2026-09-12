import { notFound, redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { getUnlockStatus } from '@/lib/data/operator-unlock';
import { getUserById } from '@/lib/data/users';
import OperatorUserProfile from './OperatorUserProfile';

export const dynamic = 'force-dynamic';

export default async function OperatorUserProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect('/login');
  if (!me.is_admin) redirect('/app');

  const { id } = await params;
  const user = await getUserById(id);
  if (!user) notFound();

  const unlock = await getUnlockStatus(me.id, id);

  return (
    <section className="stage">
      <div className="page">
        <OperatorUserProfile
          user={user}
          currentUserId={me.id}
          initialUnlocked={unlock.unlocked}
          initialExpiresAt={unlock.expiresAt}
        />
      </div>
    </section>
  );
}
