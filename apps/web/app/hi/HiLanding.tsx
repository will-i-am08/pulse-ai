import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { appBaseUrl, isMobileUserAgent, publicHiPath, smsLeadPrefillBody } from '@pulse/shared';
import { BrandLockup } from '../components/BrandLockup';
import { kipSmsComposeHref, kipSmsNumberDisplay } from '@/lib/kip-sms';
import { SmsAutoOpen } from './SmsAutoOpen';
import styles from './hi.module.css';

export const hiMetadata: Metadata = {
  title: 'Text Kip | Kip',
  description: 'Scan to text Kip. Send a photo, it writes the caption, you say yes, and it’s posted.',
};

export async function HiLanding({ source }: { source?: string | null }) {
  const smsHref = kipSmsComposeHref(source);
  const numberDisplay = kipSmsNumberDisplay();
  const prefill = smsLeadPrefillBody(source);
  let pageUrl = publicHiPath(source);
  try {
    pageUrl = `${appBaseUrl()}${publicHiPath(source)}`;
  } catch {
    // Print copy still works with the path when APP_BASE_URL isn't loaded.
  }
  const qrSrc = source ? `/hi/qr?src=${encodeURIComponent(source)}` : '/hi/qr';
  const ua = (await headers()).get('user-agent');
  const mobile = isMobileUserAgent(ua);
  const autoOpen = Boolean(mobile && smsHref);

  return (
    <main className={styles.page}>
      {smsHref ? <SmsAutoOpen href={smsHref} enabled={autoOpen} /> : null}
      <div className={styles.inner}>
        <BrandLockup href="/" className={styles.brand} size={36} />

        <section className={styles.hero}>
          <h1 className={styles.h1}>
            Text a photo.
            <br />
            It’s posted.
          </h1>
          <p className={styles.sub}>Scan, send, and Kip texts you a signup link. Nothing posts without your yes.</p>

          {smsHref ? (
            <>
              <p className={styles.status}>
                {autoOpen
                  ? 'Opening Messages… Tap Text Kip if nothing happens.'
                  : 'Tap Text Kip to open a prefilled message.'}
              </p>
              <a className={styles.cta} href={smsHref}>
                Text Kip
              </a>
              <p className={styles.fallback}>
                {numberDisplay ? (
                  <>
                    Or message <strong>{numberDisplay}</strong> and send “{prefill}”.
                  </>
                ) : (
                  <>Or send “{prefill}” to Kip.</>
                )}
              </p>
            </>
          ) : (
            <>
              <p className={styles.status}>Kip’s text line isn’t configured here yet. Sign up on the web instead.</p>
              <Link className={styles.cta} href="/signup">
                Sign up
              </Link>
            </>
          )}

          <p className={styles.alt}>
            Prefer the form? <Link href="/signup">Create an account</Link>
          </p>
        </section>

        <section className={styles.print} aria-label="Print this QR">
          <h2>For flyers, cards, and posters</h2>
          <p>
            Print this QR. It opens this page, not a raw sms link, so you can change the message later. Keep the URL
            under the code as a backup.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.qr} src={qrSrc} width={220} height={220} alt="QR code to text Kip" />
          <dl className={styles.suggested}>
            <dt>Headline</dt>
            <dd>Text a photo. It’s posted.</dd>
            <dt>Line under the QR</dt>
            <dd>Scan to text Kip</dd>
            <dt>Backup URL</dt>
            <dd>{pageUrl}</dd>
            {source ? (
              <>
                <dt>Campaign</dt>
                <dd>{source}</dd>
              </>
            ) : null}
          </dl>
          <a className={styles.download} href={`${qrSrc}${qrSrc.includes('?') ? '&' : '?'}download=1`}>
            Download QR
          </a>
        </section>
      </div>
    </main>
  );
}
