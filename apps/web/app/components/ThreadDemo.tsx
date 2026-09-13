'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import styles from './ThreadDemo.module.css';

const CAPTION =
  'Saturday morning energy — first pour of the day. Come grab a cup before the almond croissants go.';

const STEPS = 4;
const STEP_MS = 2200;
const LOOP_PAUSE_MS = 1600;

/** Silent autoplaying demo of the Kip text loop. Respects reduced motion. */
export function ThreadDemo() {
  const [step, setStep] = useState(0);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduce) {
      setStep(STEPS - 1);
      return;
    }
    const delay = step >= STEPS - 1 ? LOOP_PAUSE_MS : STEP_MS;
    const id = window.setTimeout(() => {
      setStep((s) => (s + 1) % STEPS);
    }, delay);
    return () => window.clearTimeout(id);
  }, [step, reduce]);

  return (
    <figure className={styles.demo} aria-label="Animated demo: text a photo, Kip writes, you say yes">
      <div className={styles.phone}>
        <div className={styles.notch} aria-hidden="true" />
        <div className={styles.thread}>
          <div
            className={`${styles.bubble} ${styles.out} ${styles.photoBubble} ${step >= 0 ? styles.show : ''}`}
          >
            <Image
              className={styles.photo}
              src="/brand/thread-photo.jpg"
              alt=""
              width={320}
              height={320}
              sizes="200px"
            />
          </div>
          <div className={`${styles.bubble} ${styles.in} ${step >= 1 ? styles.show : ''}`}>
            <p>
              {CAPTION}
              <br />
              <br />
              Reply yes to post to Instagram and Facebook.
            </p>
          </div>
          <div
            className={`${styles.bubble} ${styles.out} ${styles.yesBubble} ${step >= 2 ? styles.show : ''}`}
          >
            <p className={styles.yes}>yes</p>
          </div>
          <div className={`${styles.status} ${step >= 3 ? styles.show : ''}`} aria-live="polite">
            Posted to Instagram · Facebook
          </div>
        </div>
      </div>
      <figcaption className={styles.caption}>
        <span className={styles.captionLabel}>Watch the loop</span>
        Text a photo. Kip writes. You say yes. About a minute of your day.
      </figcaption>
    </figure>
  );
}
