/**
 * Lab harness: exercise offered-draft tools against the live Lab Cafe brand.
 * Usage: DATABASE_URL=... ANTHROPIC_API_KEY=dummy pnpm exec tsx scripts/lab-draft-agent-test.ts
 */
import { randomUUID } from "node:crypto";
import { query, queryOne, putMedia, getMedia, type Brand, type Post } from "@pulse/shared";
import {
  executeAgentTool,
  formatOfferedDraftBlock,
  generalAgentEligible,
  loadOfferedDraft,
} from "@pulse/orchestrator";

const LAB_ID = "25479387-684a-4e64-9fb5-6bf80867ec2c";
const line = (s: string) => console.log(s);

async function ensureCleanSource(brandId: string, fromMediaId: string): Promise<string> {
  const existing = await getMedia(fromMediaId);
  let bytes: Uint8Array;
  if (existing?.bytes?.length) {
    bytes = new Uint8Array(existing.bytes);
  } else {
    const imgUrl = "https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG";
    const res = await fetch(imgUrl);
    if (!res.ok) throw new Error(`fetch test image failed: ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const id = randomUUID();
  await query(
    `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
     values ($1::uuid, $2::uuid, $1::text, 'photo', 'operator', 'image/jpeg')`,
    [id, brandId],
  );
  await putMedia(id, bytes, "image/jpeg");
  return id;
}

async function main() {
  const brand = await queryOne<Brand>(`select * from brands where id = $1`, [LAB_ID]);
  if (!brand?.facts?.lab) throw new Error("Lab Cafe brand not found");
  line(`Lab brand: ${brand.name} (${brand.id})`);

  // Reject any stale pending so our fixture is the offered draft.
  await query(
    `update posts set status = 'rejected', updated_at = now()
      where brand_id = $1 and status = 'pending_approval'`,
    [brand.id],
  );

  const tiledId = "07b8678d-9057-4094-813d-fbc057f3c81f";
  const sourceId = await ensureCleanSource(brand.id, tiledId);
  line(`Source media ${sourceId.slice(0, 8)} (clean) · tiled ${tiledId.slice(0, 8)}`);

  const post = await queryOne<Post>(
    `insert into posts (
       brand_id, caption, media_ids, source_media_ids, style_meta,
       format, platform, status, scheduled_at, destinations
     ) values (
       $1, $2, $3::uuid[], $4::uuid[], $5::jsonb,
       'feed', 'instagram', 'pending_approval', now() + interval '1 day', array['instagram']::text[]
     ) returning *`,
    [
      brand.id,
      "You can spend six figures on the car or six figures on the system. Only one compounds.",
      [tiledId],
      [sourceId],
      JSON.stringify({
        wants_text: true,
        headline: "CAR VS ENGINE",
        generated: true,
        lab_harness: true,
      }),
    ],
  );
  if (!post) throw new Error("failed to insert pending fixture");
  line(`\n① Offered draft ${post.id.slice(0, 8)}`);
  line(formatOfferedDraftBlock(post));

  const eligible = generalAgentEligible({
    flag: true,
    hasMedia: false,
    hasPending: true,
    ownerMessage: "Remove the text",
  });
  const yesBlocked = generalAgentEligible({
    flag: true,
    hasMedia: false,
    hasPending: true,
    ownerMessage: "yes",
  });
  line(`\n② Eligibility: "Remove the text" → ${eligible} (want true); "yes" → ${yesBlocked} (want false)`);
  if (!eligible || yesBlocked) throw new Error("eligibility matrix failed");

  const got = JSON.parse(await executeAgentTool("get_offered_draft", {}, { brand }));
  line(`\n③ get_offered_draft ok=${got.ok} pending=${got.pending}`);
  if (!got.ok || !String(got.draft).includes("Text on image: YES")) {
    throw new Error("get_offered_draft missing overlay world model");
  }

  const cleared = JSON.parse(
    await executeAgentTool("set_image_text", { enabled: false }, { brand, lastMediaUrl: {} }),
  );
  line(`\n④ set_image_text(false): ok=${cleared.ok} wants_text=${cleared.wants_text}`);
  line(`   ack: ${cleared.ackSms ?? cleared.error}`);
  if (!cleared.ok || cleared.wants_text !== false) {
    throw new Error(`clear overlay failed: ${JSON.stringify(cleared)}`);
  }

  const after = await loadOfferedDraft(brand.id);
  if (!after) throw new Error("no pending after clear");
  const meta = (after.style_meta ?? {}) as Record<string, unknown>;
  line(`\n⑤ DB after clear: media[0]=${after.media_ids[0]?.slice(0, 8)} source=${after.source_media_ids?.[0]?.slice(0, 8)}`);
  line(`   wants_text=${meta.wants_text} headline=${meta.headline ?? "(none)"}`);
  line(`   caption unchanged: ${after.caption === post.caption}`);
  if (after.media_ids[0] !== sourceId) throw new Error("media not restored to source");
  if (meta.wants_text !== false) throw new Error("wants_text not cleared");
  if (after.caption !== post.caption) throw new Error("caption was mutated");

  const noPhotoTrap = !/\b((with|using|from)\s+)?(this|the)\s+(photo|pic|picture|image|shot|video)\b/i.test(
    "I mean no text on the image".replace(/\bno text on the image\b/i, "NO_ATTACH"),
  );
  // Document: agent owns this turn when flag on (before missing-MMS). Harness checks eligibility only.
  line(`\n⑥ Agent would own "I mean no text on the image" (pending + not approval): ${generalAgentEligible({
    flag: true,
    hasMedia: false,
    hasPending: true,
    ownerMessage: "I mean no text on the image",
  })}`);
  void noPhotoTrap;

  // Leave a clean rejected fixture so Lab UI isn't stuck on harness junk.
  await executeAgentTool("reject_draft", { note: "lab harness cleanup" }, { brand });
  line(`\n✅ Lab Cafe draft-agent harness passed (world model + clear overlay + eligibility).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
