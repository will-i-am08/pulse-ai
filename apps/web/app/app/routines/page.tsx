import { redirect } from 'next/navigation';
import type { TriggerKind } from '@pulse/shared';
import { currentUser } from '@/lib/auth/current-user';
import { listBrandsForOwner } from '@/lib/data/brands';
import { listRoutines } from '@/lib/data/routines';
import { createRoutineAction, toggleRoutineAction, deleteRoutineAction } from '@/lib/actions/routines';
import { describeCron } from '@/lib/routines/cron';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Routines | Kip' };

const KIND_LABEL: Record<TriggerKind, string> = {
  checkin: 'Check-in nudge',
  report: 'Performance recap',
  reminder: 'Quiet reminder',
  alert: 'Problem alert',
};
const KIND_HINT: Record<TriggerKind, string> = {
  checkin: 'Kip prompts you to send something to post.',
  report: 'A summary of how recent posts performed.',
  reminder: 'A nudge if you’ve gone quiet.',
  alert: 'A heads-up if a publish fails.',
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default async function RoutinesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brands = await listBrandsForOwner(user.id);
  const brand = brands[0];
  if (!brand) redirect('/app');

  const { error } = await searchParams;
  const routines = await listRoutines(brand.id);

  return (
    <section className="stage">
      <div className="page">
        <h1 className="page-h1">Routines</h1>
        <p className="lead">Whatever you do on repeat, hand it to Kip. Kip runs these for you automatically.</p>

        {error && (
          <p className="banner bad">
            {error === 'schedule' ? 'That schedule didn’t look right — pick a time and try again.' : 'Please pick a routine type.'}
          </p>
        )}

        {routines.length === 0 ? (
          <p className="empty">No routines yet. Add one below and Kip will start running it.</p>
        ) : (
          routines.map((r) => (
            <div key={r.id} className="pillar" style={{ justifyContent: 'space-between' }}>
              <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                <strong>{KIND_LABEL[r.kind]}</strong>
                <div className="opt" style={{ fontSize: 13 }}>
                  {describeCron(r.schedule)}
                  {!r.enabled && ' · paused'}
                </div>
              </div>
              <div className="draft-actions" style={{ marginTop: 0 }}>
                <form action={toggleRoutineAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="enabled" value={r.enabled ? 'off' : 'on'} />
                  <button className="text-btn" type="submit">{r.enabled ? 'Pause' : 'Resume'}</button>
                </form>
                <form action={deleteRoutineAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-btn bad" type="submit">Delete</button>
                </form>
              </div>
            </div>
          ))
        )}

        <h2 style={{ marginTop: 32 }}>Add a routine</h2>
        <form action={createRoutineAction} style={{ display: 'grid', gap: 12, maxWidth: 460, marginTop: 8 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 14 }}>
            What should Kip do?
            <select name="kind" defaultValue="checkin">
              {(Object.keys(KIND_LABEL) as TriggerKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]} — {KIND_HINT[k]}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'grid', gap: 6, fontSize: 14, flex: '1 1 140px' }}>
              How often
              <select name="cadence" defaultValue="weekly">
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 14, flex: '1 1 140px' }}>
              Day (weekly)
              <select name="dow" defaultValue="1">
                {DAYS.map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6, fontSize: 14, flex: '1 1 120px' }}>
              Time
              <input type="time" name="time" defaultValue="09:00" required />
            </label>
          </div>
          <p>
            <button className="pill-dark" type="submit">Add routine</button>
          </p>
        </form>
      </div>
    </section>
  );
}
