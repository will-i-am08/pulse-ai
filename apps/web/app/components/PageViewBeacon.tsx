'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

const SESSION_KEY = 'kip_pv_sid';

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `s_${Date.now()}`;
  }
}

/** Fires a pageview beacon on every client-side route change. */
export default function PageViewBeacon() {
  const pathname = usePathname();
  const search = useSearchParams();
  const last = useRef<string | null>(null);

  useEffect(() => {
    const path = `${pathname}${search?.toString() ? `?${search.toString()}` : ''}`;
    if (last.current === path) return;
    last.current = path;

    const body = JSON.stringify({ path: pathname, sessionId: sessionId() });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/telemetry/pageview', new Blob([body], { type: 'application/json' }));
      } else {
        void fetch('/api/telemetry/pageview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: true,
        });
      }
    } catch {
      // ignore
    }
  }, [pathname, search]);

  return null;
}
