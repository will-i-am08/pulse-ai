import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDemoSession, normalizeDemoSlug } from '@pulse/orchestrator';
import styles from '../demo.module.css';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const session = await getDemoSession(normalizeDemoSlug(slug));
  if (!session) return { title: 'Demo | Kip' };
  return {
    title: `${session.brand_name ?? 'Demo'} · Kip sample posts`,
    description: session.summary?.slice(0, 140) ?? 'Sample Kip posts from your website.',
  };
}

export default async function DemoSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await getDemoSession(normalizeDemoSlug(slug));
  if (!session) notFound();

  return (
    <main className={styles.wrap}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/" aria-label="Kip">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kip-mark.png" width={32} height={32} alt="" />
          <span>Kip</span>
        </Link>

        <div className={styles.hero}>
          <h1>{session.brand_name ?? 'Kip'}</h1>
          <p>
            Sample posts Kip would draft for you — {session.look_pack?.replace(/_/g, ' ') ?? 'faithful'}{' '}
            look. Nothing is live.
          </p>
        </div>

        {session.summary ? <p className={styles.meta}>{session.summary}</p> : null}

        <div className={styles.samples}>
          {session.samples.map((s, i) => (
            <article className={styles.card} key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/jpeg;base64,${s.imageBase64}`}
                alt={s.headline}
                width={1080}
                height={1080}
              />
              <div className={styles.cardBody}>
                <strong>{s.headline}</strong>
                <p>{s.caption}</p>
              </div>
            </article>
          ))}
        </div>

        <div className={styles.cta}>
          <Link className={styles.primary} href="/signup">
            Get started
          </Link>
          <Link className={styles.ghost} href="/d/new">
            Try another site
          </Link>
        </div>
        <p className={styles.note}>
          Ready for the real thing? Sign up and text Kip a photo — nothing posts without your yes.
        </p>
      </div>
    </main>
  );
}
