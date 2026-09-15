import type { Metadata } from 'next';
import { HiLanding, hiMetadata } from './HiLanding';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = hiMetadata;

export default function HiPage() {
  return <HiLanding />;
}
