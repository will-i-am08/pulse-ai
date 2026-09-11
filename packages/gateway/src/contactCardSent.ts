/**
 * One-time Kip contact-card delivery (Twilio .vcf MMS / Linq share_contact_card).
 *
 * Stored on brands.contact_card_sent_at (not onboarding_state) so onboarding
 * saveState full-JSON replaces cannot wipe the flag and re-spam the client.
 * Claim is atomic so concurrent ACK + reply sends only attach/share once.
 */

import { query, queryOne } from "@pulse/shared";

type BrandContactCardFields = {
  contact_card_sent_at?: string | null;
  onboarding_state?: Record<string, unknown> | null;
};

/** True when this brand has not yet been stamped as receiving Kip's contact card. */
export function needsContactCard(brand: BrandContactCardFields): boolean {
  if (typeof brand.contact_card_sent_at === "string" && brand.contact_card_sent_at.length > 0) {
    return false;
  }
  const legacy = brand.onboarding_state?.["kip_contact_card_sent_at"];
  return typeof legacy !== "string" || legacy.length === 0;
}

/**
 * Atomically claim the one-time contact-card send for this brand.
 * Returns the brand id when this caller won the race, otherwise null.
 */
export async function claimContactCardSent(brandId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `update brands
        set contact_card_sent_at = now(),
            updated_at = now()
      where id = $1
        and contact_card_sent_at is null
      returning id`,
    [brandId],
  );
  return row?.id ?? null;
}

/**
 * Claim by client phone (Linq send path has the E.164, not always a brand id).
 * Picks the newest unsent brand for that phone.
 */
export async function claimContactCardSentByPhone(phone: string): Promise<string | null> {
  if (!phone) return null;
  const row = await queryOne<{ id: string }>(
    `with pick as (
       select id
         from brands
        where client_phone = $1
          and contact_card_sent_at is null
        order by created_at desc
        limit 1
     )
     update brands b
        set contact_card_sent_at = now(),
            updated_at = now()
       from pick
      where b.id = pick.id
        and b.contact_card_sent_at is null
      returning b.id`,
    [phone],
  );
  return row?.id ?? null;
}

/** Undo a claim when the provider share/send failed so a later outbound can retry. */
export async function releaseContactCardSent(brandId: string): Promise<void> {
  try {
    await query(`update brands set contact_card_sent_at = null, updated_at = now() where id = $1`, [brandId]);
  } catch (err) {
    console.warn(`releaseContactCardSent: failed for ${brandId}`, err);
  }
}
