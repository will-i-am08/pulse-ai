// Full-pipeline simulation against live Neon: inbound "photo" → agent drafts an
// in-brand caption (real LLM) → operator approves → approval gate → mock publish.
// Skips the actual SMS send (needs the Twilio number) and uses GRAPH_MODE=mock.
import { query, queryOne, putMedia } from "@pulse/shared";
import type { Brand, Message, MediaAsset, Post } from "@pulse/shared";
import { processInbound } from "@pulse/orchestrator";
import { getGraphAdapter } from "@pulse/graph";

const line = (s: string) => console.log(s);

async function main(): Promise<void> {
  const brand = await queryOne<Brand>("select * from brands where client_phone = $1", ["+61400000000"]);
  if (!brand) throw new Error("No demo brand — run `pnpm seed` first.");
  line(`Brand: ${brand.name}  (${brand.client_phone}, approver=${brand.approver})`);

  // ① simulate an inbound MMS: a captured photo + a line of text
  const asset = await queryOne<MediaAsset>(
    `insert into media_assets (brand_id, storage_path, kind, source, content_type)
     values ($1, 'pending', 'photo', 'client', 'image/jpeg') returning *`,
    [brand.id],
  );
  await query(`update media_assets set storage_path = $1 where id = $1`, [asset!.id]);
  // Fetch a real photo so the vision model actually has something to caption.
  const imgUrl = "https://upload.wikimedia.org/wikipedia/commons/4/45/A_small_cup_of_coffee.JPG";
  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) throw new Error(`could not fetch test image: ${imgRes.status}`);
  const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
  await putMedia(asset!.id, imgBytes, "image/jpeg");
  line(`   (attached a real ${(imgBytes.length / 1024).toFixed(0)}KB photo — a cup of coffee)`);
  const inbound = await queryOne<Message>(
    `insert into messages (brand_id, direction, channel, body, media_ids)
     values ($1, 'inbound', 'sms', $2, $3::uuid[]) returning *`,
    [brand.id, "new pic from this morning's batch — the new single origin", [asset!.id]],
  );
  line(`\n① INBOUND (simulated MMS): "${inbound!.body}"  + 1 photo`);

  // ② agent classifies + drafts (REAL Anthropic call against the brand voice)
  const draft = await processInbound({ brand, message: inbound!, newMedia: [asset!] });
  line(`\n② AGENT REPLY:\n${draft.reply}`);
  const pending = await queryOne<Post>(
    "select * from posts where brand_id = $1 and status = 'pending_approval' order by created_at desc limit 1",
    [brand.id],
  );
  line(`   → post ${pending!.id.slice(0, 8)} status=${pending!.status}`);

  // ③ operator approves by replying "yes"
  const yes = await queryOne<Message>(
    `insert into messages (brand_id, direction, channel, body) values ($1, 'inbound', 'sms', 'yes') returning *`,
    [brand.id],
  );
  const approval = await processInbound({ brand, message: yes!, newMedia: [] });
  line(`\n③ APPROVAL ("yes"): ${approval.reply}`);
  const approved = await queryOne<Post>("select status from posts where id = $1", [pending!.id]);
  line(`   → post status=${approved!.status}`);

  // ④ publish — worker path: assert the approval gate, then publish via mock graph
  const gate = await queryOne("select 1 from approval_log where post_id = $1 and action = 'approved'", [pending!.id]);
  if (!gate) throw new Error("approval gate: no logged approval — refusing to publish");
  const post = await queryOne<Post>("select * from posts where id = $1", [pending!.id]);
  const pub = await getGraphAdapter().publish({
    brand, platform: post!.platform, caption: post!.caption ?? "", mediaUrls: [],
  });
  await query("update posts set status = 'published', published_at = now(), external_post_id = $2 where id = $1", [post!.id, pub.externalPostId]);
  await query(
    `insert into approval_log (post_id, brand_id, action, actor, note) values ($1, $2, 'published', 'system', $3)`,
    [post!.id, brand.id, `mock publish ${pub.externalPostId}`],
  );
  line(`\n④ PUBLISHED (mock graph): ${pub.externalPostId}`);

  // ⑤ the audit trail this run produced
  const log = await query<{ action: string; actor: string }>(
    "select action, actor from approval_log where post_id = $1 order by created_at", [pending!.id],
  );
  line(`\n⑤ AUDIT TRAIL (post ${pending!.id.slice(0, 8)}):`);
  for (const l of log) line(`   ${l.action}  (${l.actor})`);

  line(`\n✅ Full pipeline ran on live Neon: draft → approve (gate logged) → publish.`);
  line(`   Skipped: the SMS send (needs Twilio number). Publish was mock (GRAPH_MODE=mock until Meta review).`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n❌ SIM FAILED:", e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); });
