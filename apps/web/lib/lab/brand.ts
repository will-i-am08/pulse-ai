import {
  emptyBrandVoiceProfile,
  queryOne,
  type Brand,
} from "@pulse/shared";

export const LAB_PHONE = "+15550000001";

/** Fetch the seeded lab brand (facts.lab = true). Creates one if missing. */
export async function getOrCreateLabBrand(): Promise<Brand> {
  const existing = await queryOne<Brand>(
    `select * from brands
      where coalesce(facts->>'lab', 'false') = 'true'
      order by created_at asc
      limit 1`,
  );
  if (existing) return existing;

  const voice = emptyBrandVoiceProfile();
  const created = await queryOne<Brand>(
    `insert into brands (
       name, client_phone, approver, status, brand_voice_profile, facts, onboarding_state
     ) values (
       $1, $2, 'operator', 'active', $3::jsonb, $4::jsonb, $5::jsonb
     )
     on conflict (client_phone) do update
       set facts = brands.facts || excluded.facts,
           name = excluded.name
     returning *`,
    [
      "Lab Cafe",
      LAB_PHONE,
      JSON.stringify(voice),
      JSON.stringify({ lab: true, owner_name: "Alex" }),
      JSON.stringify({ status: "pending" }),
    ],
  );
  if (!created) throw new Error("failed to create lab brand");
  return created;
}

export async function requireLabBrand(brandId: string): Promise<Brand> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error("lab brand not found");
  if (!brand.facts?.lab) throw new Error("not a lab brand");
  return brand;
}
