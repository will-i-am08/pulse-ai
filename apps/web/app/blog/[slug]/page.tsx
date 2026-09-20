import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BLOG_POSTS, BLOG_POSTS_BY_SLUG } from '../../../lib/blog';
import { articleSchema, breadcrumbSchema, jsonLd } from '../../../lib/seo';
import styles from '../../page.module.css';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = BLOG_POSTS_BY_SLUG[slug];
  if (!post) return { title: 'Notes' };
  return {
    title: post.title,
    description: post.blurb,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      type: 'article',
      title: `${post.title} | Kip`,
      description: post.blurb,
      url: `/blog/${slug}`,
      publishedTime: post.isoDate,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = BLOG_POSTS_BY_SLUG[slug];
  if (!post) notFound();

  return (
    <main className={styles.notesPage}>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: jsonLd([
            articleSchema({
              title: post.title,
              description: post.blurb,
              path: `/blog/${slug}`,
              datePublished: post.isoDate,
            }),
            breadcrumbSchema([
              { name: 'Home', path: '/' },
              { name: 'Notes', path: '/blog' },
              { name: post.title, path: `/blog/${slug}` },
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
