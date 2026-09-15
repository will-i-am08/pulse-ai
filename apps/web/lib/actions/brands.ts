'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { normalizePhone, type Approver, type BrandStatus } from '@pulse/shared';
import { seedBrandVoice } from '@pulse/orchestrator/seedBrandVoice';
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
  const clientPhoneRaw = String(formData.get('client_phone') ?? '').trim();

  const approverRaw = String(formData.get('approver') ?? 'operator');
  const approver = (APPROVERS as string[]).includes(approverRaw) ? (approverRaw as Approver) : 'operator';

  const statusRaw = String(formData.get('status') ?? 'active');
  const status = (STATUSES as string[]).includes(statusRaw) ? (statusRaw as BrandStatus) : 'active';

  if (!name || !clientPhoneRaw) {
    throw new Error('createBrandAction: name and client_phone are required');
  }

  // Store E.164 only. `resolveBrandByPhone` does an exact match against Twilio's
  // strict E.164 `From`, so a brand saved as "0412 345 678" or "+61 412 345 678"
  // never resolves — inbound is silently dropped as an unknown sender and
  // outbound fails. Signup already normalises (auth.ts); operator creation must too.
  const clientPhone = normalizePhone(clientPhoneRaw);
  if (!clientPhone) {
    throw new Error(
      `createBrandAction: client_phone "${clientPhoneRaw}" is not a valid phone number — ` +
        'use E.164 (+61412345678) or an Australian number (0412 345 678).',
    );
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

  redirect(`/app/brands/${brand.id}`);
}
