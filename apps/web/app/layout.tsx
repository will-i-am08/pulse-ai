import { Analytics } from '@vercel/analytics/next';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import PageViewBeacon from './components/PageViewBeacon';
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  jsonLd,
  organizationSchema,
  websiteSchema,
} from '../lib/seo';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Kip | Text a photo. It’s posted.',
    template: '%s | Kip',
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'organic social media',
    'social media manager alternative',
    'AI caption writer',
    'Instagram automation',
    'schedule social media by text',
    'small business social media',
    'social media for shops',
  ],
  authors: [{ name: 'Pulse Social Media' }],
  creator: 'Pulse Social Media',
  publisher: 'Pulse Social Media',
  alternates: { canonical: '/' },
  icons: {
    icon: '/brand/kip-logo.png',
    apple: '/apple-icon.png',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: 'Kip | Text a photo. It’s posted.',
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kip | Text a photo. It’s posted.',
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
};

export const viewport: Viewport = {
  themeColor: '#0f0f10',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Site-wide entities: one Organization + WebSite so engines resolve a
            single brand across every page. Per-page schema (Product, FAQ,
            Article) is injected by each route. */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: jsonLd([organizationSchema(), websiteSchema()]) }}
        />
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
