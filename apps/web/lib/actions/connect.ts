'use server';
import 'server-only';
import { redirect } from 'next/navigation';
import { query, queryOne, decrypt, encryptJson, type Brand, type User } from '@pulse/shared';
import { queueVoiceAnalysis, onChannelsConnectedDuringOnboarding, clearSkippedConnectFlags } from '@pulse/orchestrator';
import { sendToBrand } from '@pulse/gateway';
import { currentUser } from '@/lib/auth/current-user';
import { listManagedPages, derivePageToken } from '@/lib/meta/oauth';
import { scheduleVoiceAnalysisDrain } from '@/lib/voice/scheduleDrain';

async function ownerBrand(user: User): Promise<Brand | null> {
  return queryOne<Brand>(
    'select * from brands where owner_user_id = $1 order by created_at asc limit 1',
    [user.id],
  );
}

/** Finalise linking: turn the chosen Page into a stored, encrypted publish token. */
export async function selectPageAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brand = await ownerBrand(user!);
  if (!brand) redirect('/app?connect=nobrand');

  const pageId = String(formData.get('page_id') ?? '').trim();
  if (!pageId) redirect('/app/connect/choose?error=nopage');
  if (!brand!.platform_user_token_encrypted) redirect('/app?connect=expired');

  const userToken = decrypt(brand!.platform_user_token_encrypted);
  const pages = await listManagedPages(userToken);
  const chosen = pages.find((p) => p.id === pageId);
  if (!chosen) redirect('/app/connect/choose?error=nopage');
  // Publishing today runs through Instagram, which requires the Page to have a
  // linked IG business account. Without one, the agent can't post — so don't let
  // the user "connect" a dead end.
  if (!chosen!.igUserId) redirect('/app/connect/choose?error=noig');

  const pageToken = await derivePageToken(userToken, pageId);
  // The Page token is used for both IG publishing (via the linked IG account)
  // and Facebook Page posting.
  const encrypted = encryptJson({ ig_access_token: pageToken, fb_page_access_token: pageToken });

  // Store the durable Page token; drop the broader-scope user token now that we've
  // derived what we need (the non-expiring Page token keeps working without it).
  await query(
    `update brands set
       fb_page_id = $1,
       fb_page_name = $2,
       ig_user_id = $3,
       ig_username = $4,
       platform_tokens_encrypted = $5,
       platform_user_token_encrypted = null,
       meta_connected_at = now()
     where id = $6`,
    [chosen!.id, chosen!.name, chosen!.igUserId, chosen!.igUsername, encrypted, brand!.id],
  );

  // Kick off the voice agent: it reads their real post history and learns how
  // they write and shoot. The worker runs it; this just queues it.
  await clearSkippedConnectFlags(brand!.id).catch(() => undefined);

  const onboarding = await onChannelsConnectedDuringOnboarding(brand!.id);
  if (!onboarding.handled) {
    await queueVoiceAnalysis(brand!.id);
  } else if (onboarding.message) {
    await sendToBrand(brand!.id, onboarding.message).catch(() => undefined);
  }

  scheduleVoiceAnalysisDrain(brand!.id);

  redirect('/app?connect=success');
}

/** Normalise a phone number to E.164 (Australian default) and save it. */
export async function setPhoneAction(formData: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect('/login');
  const brand = await ownerBrand(user!);
  if (!brand) redirect('/app?connect=nobrand');

  const raw = String(formData.get('phone') ?? '').replace(/[\s()-]/g, '');
  let e164: string | null = null;
  if (/^\+\d{8,15}$/.test(raw)) e164 = raw; // already E.164
  else if (/^0\d{9}$/.test(raw)) e164 = `+61${raw.slice(1)}`; // AU 0xxxxxxxxx → +61…
  // Anything else (bare digits without a country code, wrong length) is rejected
  // rather than blindly prefixed with "+", which would mint bogus numbers.
  if (!e164) redirect('/app?phone=invalid');

  // Replace the `signup:<id>` placeholder with the real number, and arm the agent
  // to reach out when setup has never completed. Do not re-arm brands that already
  // finished onboarding (completed_at survives status parking as "none").
  try {
    await query(
      `update brands set client_phone = $1,
         onboarding_state = case
           when onboarding_state->>'status' = 'none'
            and onboarding_state->>'completed_at' is null
           then '{"status":"pending"}'::jsonb
           else onboarding_state
         end
       where id = $2`,
      [e164, brand!.id],
    );
  } catch (err) {
    // client_phone is UNIQUE — a number already in use surfaces as a 23505.
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === '23505') {
      redirect('/app?phone=taken');
    }
    throw err;
  }

  redirect('/app?phone=saved');
}
