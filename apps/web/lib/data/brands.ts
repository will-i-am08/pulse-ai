import 'server-only';
import { query, queryOne } from '@pulse/shared';
import type { Approver, Brand, BrandStatus, BrandVoiceProfile, User } from '@pulse/shared';

export async function listBrands(): Promise<Brand[]> {
  return query<Brand>(`select * from brands order by created_at desc`);
}

export async function listBrandsForOwner(ownerId: string): Promise<Brand[]> {
  return query<Brand>(`select * from brands where owner_user_id = $1 order by created_at desc`, [ownerId]);
}

export async function getBrand(brandId: string): Promise<Brand | null> {
  return queryOne<Brand>(`select * from brands where id = $1`, [brandId]);
}

/** Load a brand only if the user owns it (or is admin). Returns null otherwise. */
export async function getBrandForUser(brandId: string, user: User): Promise<Brand | null> {
  const brand = await getBrand(brandId);
  if (!brand) return null;
  if (user.is_admin || brand.owner_user_id === user.id) return brand;
  return null;
}

export async function insertBrand(input: {
  name: string;
  client_phone: string;
  approver: Approver;
  status: BrandStatus;
}): Promise<Brand> {
  const brand = await queryOne<Brand>(
    `insert into brands (name, client_phone, approver, status)
     values ($1, $2, $3, $4)
     returning *`,
    [input.name, input.client_phone, input.approver, input.status]
  );
  if (!brand) throw new Error('insertBrand: insert returned no row');
  return brand;
}

export async function updateBrandVoiceProfile(brandId: string, profile: BrandVoiceProfile): Promise<void> {
  await query(`update brands set brand_voice_profile = $1::jsonb where id = $2`, [
    JSON.stringify(profile),
    brandId,
  ]);
}

export type DeleteBrandResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'has_owner' };

/**
 * Permanently delete a brand that has no owner. Cascades brand-scoped data via
 * existing FKs. Refuses brands still attached to a user — delete the user
 * (hard) instead, which cascades their brands.
 */
export async function deleteUnownedBrand(brandId: string): Promise<DeleteBrandResult> {
  const brand = await getBrand(brandId);
  if (!brand) return { ok: false, error: 'not_found' };
  if (brand.owner_user_id) return { ok: false, error: 'has_owner' };

  await query(`delete from brands where id = $1 and owner_user_id is null`, [brandId]);
  return { ok: true };
}
