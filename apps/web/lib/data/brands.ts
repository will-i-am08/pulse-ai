import 'server-only';
import { query, queryOne } from '@pulse/shared';
import type { Approver, Brand, BrandStatus, BrandVoiceProfile } from '@pulse/shared';

export async function listBrands(): Promise<Brand[]> {
  return query<Brand>(`select * from brands order by created_at desc`);
}

export async function getBrand(brandId: string): Promise<Brand | null> {
  return queryOne<Brand>(`select * from brands where id = $1`, [brandId]);
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
