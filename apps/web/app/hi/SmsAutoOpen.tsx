'use client';

import { useEffect } from 'react';

/** Best-effort: send phones to the prefilled SMS composer. A tap on Text Kip is the real CTA. */
export function SmsAutoOpen({ href, enabled }: { href: string; enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !href) return;
    const timer = window.setTimeout(() => {
      window.location.href = href;
    }, 200);
    return () => window.clearTimeout(timer);
  }, [href, enabled]);

  return null;
}
