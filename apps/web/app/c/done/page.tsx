export const dynamic = 'force-dynamic';
export const metadata = { title: 'Connected | Kip' };

const COPY: Record<string, { title: string; body: string }> = {
  success: {
    title: 'You\'re connected',
    body: 'All set — Kip just texted you a confirmation. You can close this and head back to your messages.',
  },
  denied: {
    title: 'Connection cancelled',
    body: 'No worries. Text Kip if you want another link.',
  },
  failed: {
    title: 'Something went wrong',
    body: 'Text Kip and ask for a fresh connect link — we\'ll try again.',
  },
  invalid: {
    title: 'Invalid link',
    body: 'That link isn\'t valid. Text Kip and ask to connect Instagram.',
  },
  expired: {
    title: 'Link expired',
    body: 'This link expired. Text Kip and I\'ll send a fresh one.',
  },
  nopages: {
    title: 'No Pages found',
    body: 'Facebook didn\'t return any Pages you admin. Check your Meta Business setup, then ask Kip for a new link.',
  },
  nobrand: {
    title: 'Brand not found',
    body: 'Text Kip for help reconnecting.',
  },
};

export default async function SmsConnectDonePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const copy = COPY[status ?? ''] ?? COPY.invalid!;

  return (
    <main
      style={{
        maxWidth: 420,
        margin: '3rem auto',
        padding: '0 1.25rem',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontSize: '1.35rem', marginBottom: 8 }}>{copy.title}</h1>
      <p style={{ color: '#444' }}>{copy.body}</p>
    </main>
  );
}
