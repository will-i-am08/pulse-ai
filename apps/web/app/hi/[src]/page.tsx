import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { normalizeSmsLeadSource } from '@pulse/shared';
import { HiLanding, hiMetadata } from '../HiLanding';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ src: string }>;
}): Promise<Metadata> {
  const { src } = await params;
  const source = normalizeSmsLeadSource(src);
  if (!source) return hiMetadata;
  return { ...hiMetadata, title: `Text Kip (${source}) | Kip` };
}

export default async function HiSourcePage({ params }: { params: Promise<{ src: string }> }) {
  const { src } = await params;
  const source = normalizeSmsLeadSource(src);
  if (!source) redirect('/hi');
  return <HiLanding source={source} />;
}
