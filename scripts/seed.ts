/**
 * Dev seed — one demo brand so you can exercise the round-trip before real
 * clients exist. Idempotent (safe to re-run). Requires DATABASE_URL set.
 *   pnpm seed        (tsx --env-file=.env scripts/seed.ts)
 */
import { query, queryOne, emptyBrandVoiceProfile } from "@pulse/shared";

async function main(): Promise<void> {
  const voice = {
    ...emptyBrandVoiceProfile(),
    tone: ["warm", "concise"],
    dos: ["mention specials"],
    donts: ["no clickbait"],
    example_captions: ["Fresh beans, fresh start. ☕"],
    emoji_policy: "sparing" as const,
    hashtag_policy: "2-3 local tags",
  };

  const brand = await queryOne<{ id: string }>(
    `insert into brands (name, client_phone, approver, status, brand_voice_profile)
     values ($1, $2, 'operator', 'active', $3::jsonb)
     on conflict (client_phone) do update
       set name = excluded.name, brand_voice_profile = excluded.brand_voice_profile
     returning id`,
    ["Demo Cafe", "+61400000000", JSON.stringify(voice)],
  );
  if (!brand) throw new Error("brand upsert returned no row");
  const brandId = brand.id;

  await query(
    `insert into strategy_notes (brand_id, posting_cadence, best_times, content_mix)
     values ($1, $2, $3::jsonb, '{}'::jsonb)
     on conflict (brand_id) do update
       set posting_cadence = excluded.posting_cadence, best_times = excluded.best_times`,
    [brandId, "3x per week", JSON.stringify({ mon: ["09:00"], wed: ["12:00"], fri: ["17:00"] })],
  );

  for (const t of [
    { kind: "checkin", schedule: "0 9 * * 1" },
    { kind: "report", schedule: "5 9 * * 1" },
  ]) {
    const existing = await queryOne<{ id: string }>(
      `select id from proactive_triggers where brand_id = $1 and kind = $2 limit 1`,
      [brandId, t.kind],
    );
    if (!existing) {
      await query(
        `insert into proactive_triggers (brand_id, kind, schedule, enabled)
         values ($1, $2, $3, true)`,
        [brandId, t.kind, t.schedule],
      );
    }
  }

  console.log(`✅ Seeded brand "Demo Cafe" — id ${brandId}`);


  // Lab brand — Twilio-free agent testing workspace (facts.lab = true).
  const labVoice = {
    ...emptyBrandVoiceProfile(),
    tone: ["warm", "direct"],
    dos: ["keep it short"],
    donts: ["no jargon"],
    example_captions: ["Fresh out of the lab."],
    emoji_policy: "sparing" as const,
    hashtag_policy: "none",
  };
  const lab = await queryOne<{ id: string }>(
    `insert into brands (name, client_phone, approver, status, brand_voice_profile, facts, onboarding_state)
     values ($1, $2, 'operator', 'active', $3::jsonb, $4::jsonb, $5::jsonb)
     on conflict (client_phone) do update
       set name = excluded.name,
           brand_voice_profile = excluded.brand_voice_profile,
           facts = brands.facts || excluded.facts,
           onboarding_state = coalesce(brands.onboarding_state, excluded.onboarding_state)
     returning id`,
    [
      "Lab Cafe",
      "+15550000001",
      JSON.stringify(labVoice),
      JSON.stringify({ lab: true, owner_name: "Alex" }),
      JSON.stringify({ status: "pending" }),
    ],
  );
  if (!lab) throw new Error("lab brand upsert returned no row");
  console.log(`✅ Seeded lab brand "Lab Cafe" — id ${lab.id} (facts.lab=true, phone +15550000001)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Seed failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
