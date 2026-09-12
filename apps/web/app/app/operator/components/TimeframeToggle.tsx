'use client';

import Link from 'next/link';
import type { MetricsTimeframe } from '@/lib/metrics/types';
import { timeframeLabel } from '@/lib/metrics/types';

const OPTIONS: MetricsTimeframe[] = ['7d', '30d', '90d', '12m', 'all'];

export default function TimeframeToggle({
  current,
  basePath = '/app/operator',
}: {
  current: MetricsTimeframe;
  basePath?: string;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} role="group" aria-label="Timeframe">
      {OPTIONS.map((tf) => {
        const href = `${basePath}?range=${tf}`;
        const on = tf === current;
        return (
          <Link
            key={tf}
            href={href}
            className={on ? 'pill-dark' : undefined}
            style={
              on
                ? undefined
                : {
                    border: '1px solid rgba(0,0,0,0.2)',
                    borderRadius: 999,
                    padding: '6px 14px',
                    fontSize: 14,
                    textDecoration: 'none',
                    color: 'inherit',
                  }
            }
          >
            {timeframeLabel(tf)}
          </Link>
        );
      })}
    </div>
  );
}
