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
import { setActiveChannel, handleInbound, sendToBrand, resolveBrand } from "@pulse/gateway";
import { startOnboarding, createInteraction, handleInteraction, analyzePerformance } from "@pulse/orchestrator";
import type { PostPerf } from "@pulse/orchestrator";
import type { InteractionKind, Platform } from "@pulse/shared";
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

  // Engagement simulator (test triage before live Meta webhooks exist):
  //   !sim <comment|dm|mention|review> <text>
  if (message.content?.startsWith("!sim")) {
    const m = message.content.match(/^!sim\s+(comment|dm|mention|review)\s+([\s\S]+)/i);
    if (!m) {
      await message.reply('Usage: `!sim <comment|dm|mention|review> <text>` — e.g. `!sim dm what time do you open?`');
      return;
    }
    const kind = m[1]!.toLowerCase() as InteractionKind;
    const text = m[2]!.trim();
    try {
      const brand = await resolveBrand(message.channelId);
      if (!brand) {
        await message.reply("No brand is linked to this channel yet.");
        return;
      }
      // Reviews come from Google (or Facebook); comments/DMs/mentions from Instagram.
      const platform = kind === "review" ? "google" : "instagram";
      const interaction = await createInteraction(brand, { platform, kind, author: "@test_customer", text });
      const res = await handleInteraction(brand, interaction);
      if (res.publicReply) await message.channel.send(`🟢 **[auto-replied to ${interaction.author}]** "${res.publicReply}"`);
      if (res.ownerMessage) await sendToBrand(brand.id, res.ownerMessage);
      if (!res.publicReply && !res.ownerMessage) await message.channel.send("🔇 **[hidden as spam — nothing sent to you]**");
    } catch (err) {
      console.error("[discord] !sim error", err);
      await message.reply("Simulation hit a snag — check the logs.");
    }
    return;
  }

  // Weekly performance digest (closed-loop learning): !digest
  if (message.content?.trim() === "!digest") {
    try {
      const brand = await resolveBrand(message.channelId);
      if (!brand) {
        await message.reply("No brand is linked to this channel yet.");
        return;
      }
      const rows = await query<{
        caption: string | null;
        platform: Platform;
        scheduled_at: string | null;
        external_post_id: string | null;
        engagement: Record<string, number>;
        pillar_name: string | null;
      }>(
        `select p.caption, p.platform, p.scheduled_at, p.external_post_id, p.engagement, pl.name as pillar_name
           from posts p left join pillars pl on pl.id = p.pillar_id
          where p.brand_id = $1 and p.status = 'published'
          order by p.published_at desc nulls last limit 30`,
        [brand.id],
      );
      const perf: PostPerf[] = [];
      for (const r of rows) {
        let engagement = r.engagement && Object.keys(r.engagement).length > 0 ? r.engagement : {};
        if (Object.keys(engagement).length === 0 && r.external_post_id) {
          try {
            engagement = await getGraphAdapter().fetchEngagement(brand, r.external_post_id, r.platform);
            await query(`update posts set engagement = $1::jsonb where external_post_id = $2`, [JSON.stringify(engagement), r.external_post_id]);
          } catch {
            /* leave empty */
          }
        }
        perf.push({ caption: r.caption, pillar_name: r.pillar_name, platform: r.platform, scheduled_at: r.scheduled_at, engagement });
      }
      const { text } = analyzePerformance(perf);
      await message.channel.send(text);
    } catch (err) {
      console.error("[discord] !digest error", err);
      await message.reply("Digest hit a snag — check the logs.");
    }
    return;
  }

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
    // Atomically claim the post — an overlapping tick that re-selected the same
    // row gets 0 rows back here and skips, so nothing publishes twice.
    const claimed = await query<{ id: string }>(
      "update posts set status = 'publishing' where id = $1 and status in ('approved','scheduled') returning id",
      [post.id],
    );
    if (claimed.length === 0) continue;
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
let publishRunning = false;
setInterval(() => {
  if (publishRunning) return; // don't let a slow pass overlap the next tick
  publishRunning = true;
  publishApproved()
    .catch((err) => console.error("[discord] publish loop error", err))
    .finally(() => {
      publishRunning = false;
    });
}, 5000);

// ─── Proactive gap-fill: nudge the client before a pillar's week runs dry ────
const GAP_PING_THROTTLE_MS = 24 * 60 * 60 * 1000;

async function gapFillCheck(): Promise<void> {
  const brands = await query<Brand>("select * from brands where status = 'active'");
  for (const brand of brands) {
    // Skip nudges while a pillar-pausing campaign is running.
    const paused = await queryOne(
      `select 1 from campaigns where brand_id = $1 and status = 'active' and pause_pillars = true
        and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at >= now()) limit 1`,
      [brand.id],
    );
    if (paused) continue;
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

let gapFillRunning = false;
function runGapFill() {
  if (gapFillRunning) return;
  gapFillRunning = true;
  gapFillCheck()
    .catch((err) => console.error("[discord] gap-fill error", err))
    .finally(() => {
      gapFillRunning = false;
    });
}
setInterval(runGapFill, 2 * 60 * 60 * 1000);
// First pass shortly after startup so a fresh account gets a nudge.
setTimeout(runGapFill, 20000);

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
let onboardingRunning = false;
setInterval(() => {
  if (onboardingRunning) return; // avoid overlapping passes double-greeting a signup
  onboardingRunning = true;
  initiatePendingOnboarding()
    .catch((err) => console.error("[discord] onboarding loop error", err))
    .finally(() => {
      onboardingRunning = false;
    });
}, 5000);

client.login(env.DISCORD_BOT_TOKEN);
