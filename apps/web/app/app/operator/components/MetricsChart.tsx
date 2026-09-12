'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { SeriesPoint } from '@/lib/metrics/types';

export default function MetricsChart({
  data,
  color = '#1a1a1a',
  valuePrefix = '',
  emptyLabel = 'No data in this range yet.',
}: {
  data: SeriesPoint[];
  color?: string;
  valuePrefix?: string;
  emptyLabel?: string;
}) {
  if (!data.some((d) => d.value > 0)) {
    return (
      <p className="empty" style={{ margin: '12px 0 0' }}>
        {emptyLabel}
      </p>
    );
  }

  return (
    <div style={{ width: '100%', height: 220, marginTop: 12 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
          <XAxis dataKey="bucket" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} minTickGap={24} />
          <YAxis tick={{ fontSize: 11 }} width={40} allowDecimals={false} />
          <Tooltip
            formatter={(value) => [`${valuePrefix}${value ?? 0}`, '']}
            labelFormatter={(label) => String(label)}
          />
          <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
