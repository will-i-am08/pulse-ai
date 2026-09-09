import Image from 'next/image';
import Link from 'next/link';

type Props = {
  href?: string;
  className?: string;
  size?: number;
  /** White mark is for dark surfaces only. */
  variant?: 'black' | 'white';
};

export function BrandLockup({ href, className, size = 28, variant = 'black' }: Props) {
  const src =
    variant === 'white' ? '/brand/pulse-logo-white.png' : '/brand/pulse-logo-black.png';
  const mark = (
    <>
      <Image src={src} alt="" width={size} height={size} priority />
      <span>Pulse</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-label="Pulse">
        {mark}
      </Link>
    );
  }

  return (
    <span className={className} aria-label="Pulse">
      {mark}
    </span>
  );
}
