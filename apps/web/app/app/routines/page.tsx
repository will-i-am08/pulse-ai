import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/current-user';
import { PreviewComposer } from '../PreviewComposer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Routines | Kip' };

const SKILLS: [string, string, boolean][] = [
  ['draft', 'Draft captions', true],
  ['replies', 'Reply to comments', true],
  ['reports', 'Weekly reports', true],
  ['ads', 'Paid ads', false],
];

export default async function RoutinesPage() {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <section className="stage">
      <div className="page">
        <h1 className="page-h1">
          Routines
          <span className="preview-tag">Preview</span>
        </h1>
        <p className="lead">Whatever you do on repeat, hand it to Kip. A sentence is all it takes.</p>

        <div className="rrow">
          <span>Weekly check-in</span>
          <span className="opt">Mondays · 9:00 am</span>
        </div>
        <div className="rrow">
          <span>Friday recap</span>
          <span className="opt">Fridays · 4:00 pm</span>
        </div>
        <div className="rrow">
          <span>Quiet reminder</span>
          <span className="opt">If no photo in 10 days</span>
        </div>

        <div style={{ marginTop: 22 }}>
          <PreviewComposer
            placeholder="e.g. Nudge me every Thursday for a reel"
            button="Add routine"
            note="Custom routines aren’t wired to the scheduler yet. The three above run today; tell Kip in your thread to add more for now."
          />
        </div>

        <h2 style={{ marginTop: 36 }}>
          Skills
          <span className="preview-tag">Preview</span>
        </h2>
        <p className="empty" style={{ margin: '0 0 8px' }}>
          Kip picks the right one on its own. Per-brand toggles are coming — for now this reflects the defaults.
        </p>
        {SKILLS.map(([key, name, on]) => (
          <label key={key} className="toggle">
            <span>{name}</span>
            <input type="checkbox" defaultChecked={on} disabled />
          </label>
        ))}
      </div>
    </section>
  );
}
