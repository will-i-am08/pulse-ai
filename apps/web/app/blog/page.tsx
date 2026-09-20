import type { Metadata } from 'next';
import Link from 'next/link';
import { BLOG_POSTS as NOTES } from '../../lib/blog';
import { absoluteUrl, breadcrumbSchema, jsonLd } from '../../lib/seo';
import styles from '../page.module.css';

export const metadata: Metadata = {
  title: 'Notes',
  description: 'Short notes on organic social, voice, and running a shop without a content intern.',
  alternates: { canonical: '/blog' },
  openGraph: {
    type: 'website',
    title: 'Notes | Kip',
    description:
      'Short notes on organic social, voice, and running a shop without a content intern.',
    url: '/blog',
  },
};

export default function BlogIndexPage() {
  const blogSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Kip Notes',
    url: absoluteUrl('/blog'),
    blogPost: NOTES.map((n) => ({
      '@type': 'BlogPosting',
      headline: n.title,
      description: n.blurb,
      datePublished: n.isoDate,
      url: absoluteUrl(`/blog/${n.slug}`),
    })),
  };

  return (
    <main className={styles.notesPage}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            blogSchema,
            breadcrumbSchema([
              { name: 'Home', path: '/' },
              { name: 'Notes', path: '/blog' },
            ]),
          ]),
        }}
      />
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
