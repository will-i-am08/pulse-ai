import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from '../../page.module.css';

const POSTS: Record<
  string,
  { title: string; date: string; paragraphs: string[] }
> = {
  'text-a-photo': {
    title: 'Why Kip starts with a text thread',
    date: 'Sep 2026',
    paragraphs: [
      'Most social tools ask you to open a dashboard, drag assets into a calendar, and remember to come back. Shop owners don’t forget social because they’re lazy — they forget because the work is on the floor, and the phone is already in their pocket.',
      'Kip lives in that pocket. You text a photo. Kip writes the caption in your voice. You say yes. It posts. The loop is short enough to finish between customers.',
      'Dashboards still exist if you want them. The point is you shouldn’t need one to stay consistent.',
    ],
  },
  'organic-only': {
    title: 'Organic only — on purpose',
    date: 'Sep 2026',
    paragraphs: [
      'Paid ads are a different sport: budgets, creative tests, attribution arguments. Useful later. Not the first problem for a bakery that hasn’t posted in three weeks.',
      'Kip stays in organic — Instagram, Facebook, X, Threads — so the product stays sharp. Captions, calendar, nudges, recaps, autopilot when you want evenings back.',
      'If you need media buying, hire for that. Kip’s job is showing up every week without sounding like a robot or a retainer.',
    ],
  },
  'vs-hiring': {
    title: 'Kip vs hiring a social media manager',
    date: 'Sep 2026',
    paragraphs: [
      'A good social media manager is worth real money: voice, calendar, approvals, the weekly rhythm. They also cost $2,000–$5,000 a month, keep office hours, and often want decks.',
      'Kip covers the organic half of that job from $79 a month — captions, channels, calendar, yes-before-post. You send the photos. No on-site shoots. No paid ads. No stand-ups.',
      'If you need custom creative production and strategy workshops, hire a human. If you need the posting job done without another salary, text Kip.',
    ],
  },
};

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return Object.keys(POSTS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = POSTS[slug];
  if (!post) return { title: 'Notes | Kip' };
  return { title: `${post.title} | Kip`, description: post.paragraphs[0] };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = POSTS[slug];
  if (!post) notFound();

  return (
    <main className={styles.notesPage}>
      <header className={styles.notesTop}>
        <Link className={styles.notesBrand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-mark.png" width={28} height={28} alt="" />
          <span>Kip</span>
        </Link>
        <Link className={styles.notesBack} href="/blog">
          All notes
        </Link>
      </header>
      <article className={styles.notesArticle}>
        <p className={styles.notesDate}>{post.date}</p>
        <h1>{post.title}</h1>
        {post.paragraphs.map((p) => (
          <p key={p.slice(0, 24)}>{p}</p>
        ))}
        <p className={styles.notesCta}>
          <Link href="/signup">Get started with Kip</Link>
        </p>
      </article>
    </main>
  );
}
