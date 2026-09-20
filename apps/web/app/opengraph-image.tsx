import { ImageResponse } from 'next/og';
import { SITE_TAGLINE } from '../lib/seo';

// Route segment config — static 1200x630 social card.
export const alt = 'Kip — Text a photo. It’s posted.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Dynamic Open Graph / Twitter card. Uses next/og (self-contained), so it does
 * not touch the orchestrator's satori tracing config in next.config.js.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background: 'linear-gradient(135deg, #0f0f10 0%, #1c1c22 100%)',
          color: '#f7f6f3',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: '#f7f6f3',
              color: '#0f0f10',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            K
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Kip</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 92, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>
            {SITE_TAGLINE}
          </div>
          <div style={{ fontSize: 34, color: '#b9b7b1', lineHeight: 1.3, maxWidth: 900 }}>
            Kip writes the caption in your voice and posts to Instagram, Facebook, X and Threads —
            nothing without your yes.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 26, color: '#8f8d87' }}>
          <span>Instagram</span>
          <span>·</span>
          <span>Facebook</span>
          <span>·</span>
          <span>X</span>
          <span>·</span>
          <span>Threads</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
