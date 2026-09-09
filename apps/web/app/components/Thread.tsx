import Image from 'next/image';
import styles from './Thread.module.css';

type Props = {
  tone: 'dark' | 'light';
  size: 'closeup' | 'isolated';
};

export function Thread({ tone, size }: Props) {
  return (
    <figure
      className={`${styles.thread} ${styles[tone]} ${styles[size]}`}
      aria-label="A text thread: a photo sent, a caption back, the word yes"
    >
      <div className={`${styles.msg} ${styles.out}`}>
        <Image
          className={styles.photo}
          src="/brand/thread-photo.jpg"
          alt="A photo of a coffee and an almond croissant"
          width={640}
          height={640}
          priority={size === 'closeup'}
          sizes={size === 'closeup' ? '92vw' : '240px'}
        />
      </div>
      <div className={`${styles.msg} ${styles.in}`}>
        <p>
          Saturday morning energy — first pour of the day. Come grab a cup before the almond
          croissants go.
          <br />
          <br />
          Reply yes to post to Instagram and Facebook.
        </p>
      </div>
      <div className={`${styles.msg} ${styles.out}`}>
        <p className={styles.yes}>yes</p>
      </div>
    </figure>
  );
}
