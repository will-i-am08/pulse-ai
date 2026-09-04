// Discord test bot: receive a photo/video → draft a caption → approve/edit in
// the thread → an in-process publish loop posts it (mock graph) and confirms
// with a link to the fake feed. A full Twilio-free, Meta-free end-to-end loop.
import { Client, Events, GatewayIntentBits, Partials } from "discord.js";
import {
  getServerEnv,
  query,
  queryOne,
  publicMediaUrl,
  type Brand,
  type InboundMedia,
  type InboundMessage,
  type Pillar,
  type Post,
} from "@pulse/shared";
import { setActiveChannel, handleInbound, sendToBrand } from "@pulse/gateway";
import { startOnboarding } from "@pulse/orchestrator";
import { getGraphAdapter } from "@pulse/graph";
import { createDiscordChannel } from "./discord-channel.js";

const env = getServerEnv();
if (!env.DISCORD_BOT_TOKEN) {
  console.error("DISCORD_BOT_TOKEN is not set");
  process.exit(1);
}
const feedUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/feed`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — enable in the Developer Portal
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel], // required to receive DMs
});

setActiveChannel(createDiscordChannel(client));

client.once(Events.ClientReady, (c) => {
  console.log(`[discord] logged in as ${c.user.tag}`);
  console.log(`[discord] DM it a photo (or post in a channel it can see) to test. Feed: ${feedUrl}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const media: InboundMedia[] = [...message.attachments.values()].map((a) => ({
    url: a.url,
    contentType: a.contentType ?? "application/octet-stream",
  }));
  if (!message.content && media.length === 0) return;

  const inbound: InboundMessage = {
    from: message.channelId, // brands are routed by Discord channel/DM id
    to: client.user?.id ?? "",
    body: message.content ?? "",
    media,
    providerMessageId: message.id,
    raw: { channelId: message.channelId, authorId: message.author.id },
  };
  console.log(`[discord] inbound (ch ${message.channelId}): "${message.content}" +${media.length} media`);
  try {
    await handleInbound(inbound);
  } catch (err) {
    console.error("[discord] handleInbound error", err);
  }
});

// In-process publish loop: approved → published (mock), then confirm in Discord.
async function publishApproved(): Promise<void> {
  // Publish approved (human) and scheduled (autopilot) posts once their slot is
  // due. A null slot means "as soon as approved".
  const posts = await query<Post>(
    `select * from posts
      where status in ('approved', 'scheduled')
        and (scheduled_at is null or scheduled_at <= now())
      order by scheduled_at asc nulls first`,
  );
  for (const post of posts) {
    const gate = await queryOne("select 1 from approval_log where post_id = $1 and action = 'approved'", [post.id]);
    if (!gate) continue; // approval is absolute (autopilot posts get a system approval)
    await query("update posts set status = 'publishing' where id = $1", [post.id]);
    try {
      const brand = await queryOne<Brand>("select * from brands where id = $1", [post.brand_id]);
      const mediaUrls = post.media_ids.map((id) => publicMediaUrl(id));
      const res = await getGraphAdapter().publish({
        brand: brand!,
        platform: post.platform,
        caption: post.caption ?? "",
        mediaUrls,
      });
      await query(
        "update posts set status = 'published', published_at = now(), external_post_id = $2 where id = $1",
        [post.id, res.externalPostId],
      );
      const live = env.GRAPH_MODE === "live";
      await query(
        `insert into approval_log (post_id, brand_id, action, actor, note) values ($1, $2, 'published', 'system', $3)`,
        [post.id, post.brand_id, `${live ? "live" : "mock"} publish ${res.externalPostId}`],
      );
      await sendToBrand(
        post.brand_id,
        live
          ? `✅ Posted live to ${post.platform} — id ${res.externalPostId}`
          : `✅ Posted to ${post.platform}! See it on the feed: ${feedUrl}`,
      );
      console.log(`[discord] published post ${post.id.slice(0, 8)} → ${res.externalPostId}`);
    } catch (err) {
      await query("update posts set status = 'failed', last_error = $2 where id = $1", [post.id, String(err)]);
      console.error(`[discord] publish failed for post ${post.id}`, err);
    }
  }
}
setInterval(() => {
  publishApproved().catch((err) => console.error("[discord] publish loop error", err));
}, 5000);

// ─── Proactive gap-fill: nudge the client before a pillar's week runs dry ────
const GAP_PING_THROTTLE_MS = 24 * 60 * 60 * 1000;

async function gapFillCheck(): Promise<void> {
  const brands = await query<Brand>("select * from brands where status = 'active'");
  for (const brand of brands) {
    const pillars = await query<Pillar>(
      "select * from pillars where brand_id = $1 and posts_per_week > 0 order by sort, created_at",
      [brand.id],
    );
    for (const pillar of pillars) {
      if (pillar.last_gap_ping_at && Date.now() - new Date(pillar.last_gap_ping_at).getTime() < GAP_PING_THROTTLE_MS) continue;
      const row = await queryOne<{ n: number }>(
        `select count(*)::int as n from posts
          where brand_id = $1 and pillar_id = $2
            and status in ('pending_approval','approved','scheduled')
            and scheduled_at between now() and now() + interval '7 days'`,
        [brand.id, pillar.id],
      );
      const have = Number(row?.n ?? 0);
      if (have >= pillar.posts_per_week) continue;
      await sendToBrand(
        brand.id,
        `Heads up — your "${pillar.name}" content is a little light this week (${have}/${pillar.posts_per_week} planned). Send me a photo for it, or reply "draft one" and I'll write a post you can approve.`,
      );
      await query("update pillars set last_gap_ping_at = now() where id = $1", [pillar.id]);
      break; // at most one nudge per brand per pass — never a barrage
    }
  }
}

setInterval(() => {
  gapFillCheck().catch((err) => console.error("[discord] gap-fill error", err));
}, 2 * 60 * 60 * 1000);
// First pass shortly after startup so a fresh account gets a nudge.
setTimeout(() => gapFillCheck().catch(() => {}), 20000);

// Signup-driven onboarding: DM newly signed-up users first and run setup.
async function initiatePendingOnboarding(): Promise<void> {
  const pending = await query<Brand>(
    "select * from brands where onboarding_state->>'status' = 'pending' and discord_user_id is not null",
  );
  for (const brand of pending) {
    try {
      const user = await client.users.fetch(brand.discord_user_id!);
      const dm = await user.createDM();
      // Link the DM channel so their replies route back to this brand.
      await query("update brands set discord_channel_id = $2 where id = $1", [brand.id, dm.id]);
      const greeting = await startOnboarding(brand.id);
      await dm.send(greeting);
      console.log(`[discord] started onboarding for "${brand.name}" (user ${brand.discord_user_id})`);
    } catch (err) {
      console.error(`[discord] failed to start onboarding for brand ${brand.id}`, err);
      // Park it so we don't hammer a bad user id every tick.
      await query(
        "update brands set onboarding_state = jsonb_set(onboarding_state, '{status}', '\"none\"') where id = $1",
        [brand.id],
      ).catch(() => {});
    }
  }
}
setInterval(() => {
  initiatePendingOnboarding().catch((err) => console.error("[discord] onboarding loop error", err));
}, 5000);

client.login(env.DISCORD_BOT_TOKEN);
