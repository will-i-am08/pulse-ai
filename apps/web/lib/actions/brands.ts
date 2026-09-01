'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import type { Approver, BrandStatus } from '@pulse/shared';
import { seedBrandVoice } from '@pulse/orchestrator';
import { insertBrand } from '@/lib/data/brands';

const APPROVERS: Approver[] = ['operator', 'client'];
const STATUSES: BrandStatus[] = ['active', 'paused', 'archived'];

function lines(value: FormDataEntryValue | null): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Creates a brand, then — if the operator filled in any onboarding fields —
 * seeds the brand voice profile via the orchestrator's `seedBrandVoice`.
 */
export async function createBrandAction(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const clientPhone = String(formData.get('client_phone') ?? '').trim();

  const approverRaw = String(formData.get('approver') ?? 'operator');
  const approver = (APPROVERS as string[]).includes(approverRaw) ? (approverRaw as Approver) : 'operator';

  const statusRaw = String(formData.get('status') ?? 'active');
  const status = (STATUSES as string[]).includes(statusRaw) ? (statusRaw as BrandStatus) : 'active';

  if (!name || !clientPhone) {
    throw new Error('createBrandAction: name and client_phone are required');
  }

  const brand = await insertBrand({ name, client_phone: clientPhone, approver, status });

  const answers = {
    tone: lines(formData.get('tone')),
    dos: lines(formData.get('dos')),
    donts: lines(formData.get('donts')),
    example_captions: lines(formData.get('example_captions')),
  };

  const hasOnboardingInput = Object.values(answers).some((arr) => arr.length > 0);
  if (hasOnboardingInput) {
    await seedBrandVoice(brand.id, answers);
  }

  redirect(`/brands/${brand.id}`);
}
