'use client';

import { useEffect, useState } from 'react';

type Props = {
  smsHref: string | null;
  desktopHref?: string;
  className?: string;
  children?: React.ReactNode;
};

function isMobileUserAgent(ua: string): boolean {
  if (/windows phone/i.test(ua)) return true;
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  if (/Android/i.test(ua)) return true;
  return false;
}

/** Tap opens Messages on a phone; desktop goes to /hi. First paint uses desktopHref so no-JS lands on /hi. */
export function TextKipCta({ smsHref, desktopHref = '/hi', className, children = 'Text Kip' }: Props) {
  const [href, setHref] = useState(desktopHref);

  useEffect(() => {
    setHref(isMobileUserAgent(navigator.userAgent) && smsHref ? smsHref : desktopHref);
  }, [smsHref, desktopHref]);

  return (
    <a className={className} href={href}>
      {children}
    </a>
  );
}
