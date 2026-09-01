/**
 * Dev seed — one demo brand so you can exercise the round-trip before real
 * clients exist. Idempotent (safe to re-run). Requires a live Supabase project
 * with the migrations applied, and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set.
 *
 *   pnpm seed        (runs: tsx --env-file=.env scripts/seed.ts)
 */
import { serviceClient, emptyBrandVoiceProfile } from "@pulse/shared";

async function main(): Promise<void> {
  const db = serviceClient();

  const voice = {
    ...emptyBrandVoiceProfile(),
    tone: ["warm", "concise"],
    dos: ["mention specials"],
    donts: ["no clickbait"],
    example_captions: ["Fresh beans, fresh start. ☕"],
    emoji_policy: "sparing" as const,
    hashtag_policy: "2-3 local tags",
  };

  // Upsert the brand on its unique client_phone.
  const { data: brand, error: brandErr } = await db
    .from("brands")
    .upsert(
      {
        name: "Demo Cafe",
        client_phone: "+61400000000",
        approver: "operator",
        status: "active",
        brand_voice_profile: voice,
      },
      { onConflict: "client_phone" },
    )
    .select()
    .single();

  if (brandErr) throw new Error(`brand upsert failed: ${brandErr.message}`);
  const brandId = brand.id as string;

  // One strategy_notes row per brand (brand_id is unique).
  const { error: notesErr } = await db.from("strategy_notes").upsert(
    {
      brand_id: brandId,
      posting_cadence: "3x per week",
      best_times: { mon: ["09:00"], wed: ["12:00"], fri: ["17:00"] },
      content_mix: {},
    },
    { onConflict: "brand_id" },
  );
  if (notesErr) throw new Error(`strategy_notes upsert failed: ${notesErr.message}`);

  // Proactive triggers — insert only if the (brand_id, kind) pair is absent.
  const triggers = [
    { kind: "checkin", schedule: "0 9 * * 1" }, // Mon 09:00
    { kind: "report", schedule: "5 9 * * 1" }, // Mon 09:05
  ];
  for (const t of triggers) {
    const { data: existing, error: exErr } = await db
      .from("proactive_triggers")
      .select("id")
      .eq("brand_id", brandId)
      .eq("kind", t.kind)
      .limit(1);
    if (exErr) throw new Error(`trigger lookup failed: ${exErr.message}`);
    if (existing && existing.length > 0) continue;

    const { error: insErr } = await db
      .from("proactive_triggers")
      .insert({ brand_id: brandId, kind: t.kind, schedule: t.schedule, enabled: true });
    if (insErr) throw new Error(`trigger insert (${t.kind}) failed: ${insErr.message}`);
  }

  console.log(`✅ Seeded brand "Demo Cafe" — id ${brandId}`);
  console.log("   Text +61400000000's number into your Twilio inbox to exercise the round-trip once wired.");
}

main().catch((err) => {
  console.error("❌ Seed failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
