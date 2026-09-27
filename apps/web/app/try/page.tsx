import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Try Kip — text a photo, it’s posted',
  description:
    'Drag a photo into Kip and watch it write the caption in your voice and post to Instagram, Facebook, X and Threads. No sign-up.',
};

/**
 * Interactive "text a photo, it's posted" demo.
 *
 * The experience is a self-contained page served from /public/try.html (all
 * markup, styles and drag/drop logic inline). Hosting it here gives it a clean
 * /try route that shares the domain. It can be ported to a native React client
 * component later without changing this URL.
 */
export default function TryPage() {
  return (
    <iframe
      src="/try.html"
      title="Kip interactive demo — text a photo, it's posted"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0 }}
    />
  );
}
