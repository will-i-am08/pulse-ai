import { Analytics } from '@vercel/analytics/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import PageViewBeacon from './components/PageViewBeacon';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kip',
  description: "Text a photo. Kip writes the caption, you say yes, and it's posted.",
  icons: {
    icon: '/brand/kip-logo.png',
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Vercel Web Analytics — tracks landing + app pageviews in production. */}
        <Analytics />
        {/* First-party beacon — feeds operator Overview even before Vercel API is wired. */}
        <Suspense fallback={null}>
          <PageViewBeacon />
        </Suspense>
      </body>
    </html>
  );
}
