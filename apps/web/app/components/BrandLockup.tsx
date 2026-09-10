import Link from 'next/link';
import { KipMark } from './KipMark';

type Props = {
  href?: string;
  className?: string;
  size?: number;
};

export function BrandLockup({ href, className, size = 28 }: Props) {
  const mark = (
    <>
      <KipMark size={size} />
      <span>Kip</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className} aria-label="Kip">
        {mark}
      </Link>
    );
  }

  return (
    <span className={className} aria-label="Kip">
      {mark}
    </span>
  );
}
