import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../page.module.css';

export const metadata: Metadata = {
  title: 'Notes | Kip',
  description: 'Short notes on organic social, voice, and running a shop without a content intern.',
};

const NOTES = [
  {
    slug: 'text-a-photo',
    title: 'Why Kip starts with a text thread',
    date: 'Sep 2026',
    blurb: 'Dashboards are where posts go to die. The floor of a shop already has a phone in it.',
  },
  {
    slug: 'organic-only',
    title: 'Organic only — on purpose',
    date: 'Sep 2026',
    blurb: 'Paid ads can wait. Showing up every week in your own voice usually can’t.',
  },
  {
    slug: 'vs-hiring',
    title: 'Kip vs hiring a social media manager',
    date: 'Sep 2026',
    blurb: 'Same job on captions and calendar. Different invoice — and no awkward stand-up.',
  },
];

export default function BlogIndexPage() {
  return (
    <main className={styles.notesPage}>
      <header className={styles.notesTop}>
        <Link className={styles.notesBrand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-mark.png" width={28} height={28} alt="" />
          <span>Kip</span>
        </Link>
        <Link className={styles.notesBack} href="/#pricing">
          Get started
        </Link>
      </header>
      <div className={styles.notesInner}>
        <h1>Notes</h1>
        <p className={styles.notesLead}>Short writing on organic social. No growth-hack soup.</p>
        <ul className={styles.notesList}>
          {NOTES.map((n) => (
            <li key={n.slug}>
              <Link href={`/blog/${n.slug}`}>
                <span className={styles.notesDate}>{n.date}</span>
                <span className={styles.notesTitle}>{n.title}</span>
                <span className={styles.notesBlurb}>{n.blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
