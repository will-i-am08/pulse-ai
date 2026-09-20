import type { MetadataRoute } from 'next';
import { SITE_DESCRIPTION, SITE_NAME } from '../lib/seo';

/** Web app manifest — install metadata + richer share/PWA signals. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#0f0f10',
    theme_color: '#0f0f10',
    icons: [
      { src: '/brand/kip-logo.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/kip-logo-1024.png', sizes: '1024x1024', type: 'image/png' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
