'use server';
import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createDemoSession } from '@pulse/orchestrator';

function clientIp(h: Headers): string | null {
  const xf = h.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]?.trim() || null;
  return h.get('x-real-ip')?.trim() || null;
}

export async function createDemoAction(formData: FormData): Promise<void> {
  const url = String(formData.get('url') ?? '').trim();
  const h = await headers();
  const result = await createDemoSession({ url, creatorIp: clientIp(h) });
  if ('error' in result) {
    redirect(`/d/new?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/d/${result.slug}`);
}
