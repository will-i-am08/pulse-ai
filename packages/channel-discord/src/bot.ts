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
  type Post,
} from "@pulse/shared";
import { setActiveChannel, handleInbound, sendToBrand } from "@pulse/gateway";
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
  const posts = await query<Post>("select * from posts where status = 'approved'");
  for (const post of posts) {
    const gate = await queryOne("select 1 from approval_log where post_id = $1 and action = 'approved'", [post.id]);
    if (!gate) continue; // approval is absolute
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
      await query(
        `insert into approval_log (post_id, brand_id, action, actor, note) values ($1, $2, 'published', 'system', $3)`,
        [post.id, post.brand_id, `mock publish ${res.externalPostId}`],
      );
      await sendToBrand(post.brand_id, `✅ Posted to ${post.platform}! See it on the feed: ${feedUrl}`);
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

client.login(env.DISCORD_BOT_TOKEN);
