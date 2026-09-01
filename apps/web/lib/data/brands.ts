import 'server-only';
import { serviceClient } from '@pulse/shared';
import type { Approver, Brand, BrandStatus, BrandVoiceProfile } from '@pulse/shared';

export async function listBrands(): Promise<Brand[]> {
  const { data, error } = await serviceClient()
    .from('brands')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listBrands: ${error.message}`);
  return (data ?? []) as Brand[];
}

export async function getBrand(brandId: string): Promise<Brand | null> {
  const { data, error } = await serviceClient().from('brands').select('*').eq('id', brandId).maybeSingle();
  if (error) throw new Error(`getBrand: ${error.message}`);
  return (data as Brand | null) ?? null;
}

export async function insertBrand(input: {
  name: string;
  client_phone: string;
  approver: Approver;
  status: BrandStatus;
}): Promise<Brand> {
  const { data, error } = await serviceClient().from('brands').insert(input).select('*').single();
  if (error) throw new Error(`insertBrand: ${error.message}`);
  return data as Brand;
}

export async function updateBrandVoiceProfile(brandId: string, profile: BrandVoiceProfile): Promise<void> {
  const { error } = await serviceClient().from('brands').update({ brand_voice_profile: profile }).eq('id', brandId);
  if (error) throw new Error(`updateBrandVoiceProfile: ${error.message}`);
}
