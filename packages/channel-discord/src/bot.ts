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
import {
  setActiveChannel,
  activeChannel,
  handleInbound,
  sendToBrand,
  resolveBrand,
  resolveBrandByLinq,
  createLinqChannel,
  captureMedia,
  startTypingKeeper,
  deliverPendingLoginCodes,
} from "@pulse/gateway";
import { startOnboarding, createInteraction, claimInteraction, handleInteraction, analyzePerformance, processInbound, isDaytime, pickFreshPhoto, pickFreshPhotos, draftPostFromPhoto, dueCompetitorWatches, competitorWeeklyUpdate, markWatchSwept, chooseNextFormat, draftCarouselFromPhotos, draftStoryFromPhoto, generateTipCarousel, pendingPlans, buildPlanWithFallback, markPlanProposed, markPlanFailed, planTextSummary, gapNudgeMessage } from "@pulse/orchestrator";
import type { PostPerf } from "@pulse/orchestrator";
import type { InteractionKind, Platform, Interaction, Message } from "@pulse/shared";
import { getGraphAdapter, didPublishLive, publishConfirmation } from "@pulse/graph";
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

  // "... is typing" while any slow path below runs (!sim / !digest /
  // handleInbound). handleInbound also arms its own keeper — stopping twice is
  // safe. Best-effort: never let typing break message handling.
  let keeper: { stop(): void } | null = null;
  try {
    keeper = startTypingKeeper(activeChannel(), message.channelId);
  } catch {
    keeper = null;
  }
  try {

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
      // Reviews come from Facebook; comments/DMs/mentions from Instagram.
      const platform = kind === "review" ? "facebook" : "instagram";
      const interaction = await createInteraction(brand, { platform, kind, author: "@test_customer", text });
      const res = await handleInteraction(brand, interaction);
      if (res.publicReply) await message.channel.send(`🟢 **[auto-replied to ${interaction.author}]** "${res.publicReply}"`);
      if (res.ownerMessage) await sendToBrand(brand.id, res.ownerMessage);
      if (!res.publicReply && !res.ownerMessage) await message.channel.send("🔇 **[hidden as spam — nothing sent to you]**");
    } catch (err) {
      console.error("[discord] !sim error", err);
      await message.reply("Simulation hit a snag. Check the logs.");
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
      await message.reply("Digest hit a snag. Check the logs.");
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
  } finally {
    keeper?.stop();
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
        format: post.format,
      });
      await query(
        "update posts set status = 'published', published_at = now(), external_post_id = $2 where id = $1",
        [post.id, res.externalPostId],
      );
      const live = didPublishLive(post.platform, env.GRAPH_MODE);
      await query(
        `insert into approval_log (post_id, brand_id, action, actor, note) values ($1, $2, 'published', 'system', $3)`,
        [post.id, post.brand_id, `${live ? "live" : "mock"} publish ${res.externalPostId}`],
      );
      const postFeed =
        post.platform === "x" || post.platform === "threads" ? `${feedUrl}?platform=${post.platform}` : feedUrl;
      await sendToBrand(
        post.brand_id,
        publishConfirmation(post.platform, {
          live,
          feedUrl: postFeed,
          externalPostId: res.externalPostId,
        }),
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

/** Pick a varied chase nudge for a pending draft. */
function chaseNudge(what: string): string {
  const templates = [
    `Quick nudge — ${what} is still waiting. Want it to go out, or shall I tweak it? ("no" to bin it.)`,
    `Hey, ${what} has been sitting there. Ship it, tweak it, or scrap it?`,
    `${what} is still pending. "Yes" to post, tell me a change, or "no" to discard.`,
    `Just checking — ${what} ready to go, or want changes?`,
    `Still on ${what}? Reply "yes" to approve, edit away, or "no" to delete.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

/** Pick a varied holding message when plan research is stuck. */
function planHoldingNudge(): string {
  const templates = [
    `Still working on your content plan — the research is being stubborn but I'm on it. Will send it the moment it lands.`,
    `Content plan's taking longer than expected. Still digging, will ping you the second it's ready.`,
    `Plan research hit a snag, but I'm still going. You'll get it as soon as it's solid.`,
    `Still cooking your content plan. The deep dive is taking a bit, but it's coming.`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

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
      // Least-recently gap-filled first, so day-to-day the touch rotates across pillars.
      "select * from pillars where brand_id = $1 and posts_per_week > 0 order by last_gap_ping_at asc nulls first, sort, created_at",
      [brand.id],
    );
    // Per-brand daily cap: one proactive gap-fill touch per brand per 24h. The
    // throttle used to be per pillar, so a brand with 5 light pillars got nudged
    // every 2h for the first ~5 passes — the nag-spam. If ANY pillar was touched
    // in the last 24h, the whole brand stays quiet.
    if (pillars.some((p) => p.last_gap_ping_at && Date.now() - new Date(p.last_gap_ping_at).getTime() < GAP_PING_THROTTLE_MS)) {
      continue;
    }
    for (const pillar of pillars) {
      const row = await queryOne<{ n: number }>(
        `select count(*)::int as n from posts
          where brand_id = $1 and pillar_id = $2
            and status in ('pending_approval','approved','scheduled')
            and scheduled_at between now() and now() + interval '7 days'`,
        [brand.id, pillar.id],
      );
      const have = Number(row?.n ?? 0);
      if (have >= pillar.posts_per_week) continue;

      // Fill the gap ourselves, VARYING the format (carousel-leaning) so the feed
      // isn't monotonous — only nudge the client when we've no material.
      const fmt = await chooseNextFormat(brand.id);
      let drafted: { post: Post; mediaUrl: string | null } | null = null;
      let kind = "post";
      let auto = false;
      try {
        if (fmt === "carousel") {
          const photos = await pickFreshPhotos(brand.id, 4);
          if (photos.length >= 2) {
            drafted = await draftCarouselFromPhotos(brand, photos.map((p) => p.id), pillar);
            kind = "carousel from your photos";
          } else {
            drafted = await generateTipCarousel(brand, pillar);
            kind = "tip carousel";
          }
        } else if (fmt === "story") {
          const p = await pickFreshPhoto(brand.id);
          if (p) {
            const s = await draftStoryFromPhoto(brand, p, pillar);
            if (s) { drafted = { post: s.post, mediaUrl: s.mediaUrl }; auto = s.auto; kind = "story"; }
          }
        }
        if (!drafted) {
          // feed fallback (also covers carousel/story with no material)
          const p = await pickFreshPhoto(brand.id);
          if (p) { drafted = await draftPostFromPhoto(brand, p, pillar); kind = "post"; }
        }
      } catch (err) {
        console.error(`[discord] format gap-fill failed for ${brand.id}`, err);
      }

      if (drafted) {
        auto = auto || drafted.post.is_auto;
        const when = drafted.post.scheduled_at
          ? new Date(drafted.post.scheduled_at).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit", hour12: true })
          : "soon";
        const topic = pillar.name.toLowerCase();
        const lead = auto
          ? `We were a bit light on ${topic}, so I put together a ${kind} and scheduled it for ${when} ✨ Reply "HOLD" to stop it, or tell me a change.`
          : `We were a bit light on ${topic}, so I put together a ${kind}:\n\n"${drafted.post.caption}"\n\nProposed for ${when}. Reply "yes" to approve, tell me a change, or "no" to bin it.`;
        await sendToBrand(brand.id, lead, drafted.mediaUrl ? [drafted.mediaUrl] : undefined);
        await query("update pillars set last_gap_ping_at = now() where id = $1", [pillar.id]);
        break;
      }

      await sendToBrand(brand.id, await gapNudgeMessage(brand, pillar.name));
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

// ─── Engagement: triage inbound interactions ingested by the Meta webhook ────
async function processNewInteractions(): Promise<void> {
  const news = await query<Interaction>(
    "select * from interactions where status = 'new' order by created_at asc limit 20",
  );
  for (const it of news) {
    // Claim first: the worker engagement loop polls the same rows in
    // production. claimInteraction returns null when the worker (or a
    // previous tick) got there first — skip, never double-triage.
    const claimed = await claimInteraction(it.id).catch(() => null);
    if (!claimed) continue;
    const brand = await queryOne<Brand>("select * from brands where id = $1", [it.brand_id]);
    if (!brand) {
      await query("update interactions set status = 'resolved' where id = $1", [it.id]);
      continue;
    }
    try {
      const res = await handleInteraction(brand, claimed);
      if (res.ownerMessage) await sendToBrand(brand.id, res.ownerMessage);
      if (res.publicReply) {
        // IG/FB replies need the messaging/comment permission (App Review).
        console.log(`[discord] engagement reply (would post to ${it.platform}): ${res.publicReply.slice(0, 120)}`);
      }
    } catch (err) {
      console.error(`[discord] engagement processing failed for interaction ${it.id}`, err);
      // Release the claim so the worker (or next tick) retries instead of
      // stranding the row in 'triaging'.
      await query("update interactions set status = 'new' where id = $1", [it.id]).catch(() => {});
    }
  }
}
let engagementRunning = false;
setInterval(() => {
  if (engagementRunning) return;
  engagementRunning = true;
  processNewInteractions()
    .catch((err) => console.error("[discord] engagement loop error", err))
    .finally(() => {
      engagementRunning = false;
    });
}, 5000);

// Passwordless-login codes: deliver any the dashboard has queued, through the
// user's own thread. The bot holds the Discord channel, so it does the sending.
let loginCodesRunning = false;
setInterval(() => {
  if (loginCodesRunning) return;
  loginCodesRunning = true;
  deliverPendingLoginCodes()
    .then((n) => {
      if (n > 0) console.log(`[discord] delivered ${n} login code(s)`);
    })
    .catch((err) => console.error("[discord] login-code delivery error", err))
    .finally(() => {
      loginCodesRunning = false;
    });
}, 4000);

// ─── Linq: process queued inbound (the webhook only ingests; we do the work) ─
async function processLinqInbound(): Promise<void> {
  const rows = await query<{
    id: string;
    from_handle: string;
    body: string | null;
    media: InboundMedia[];
    provider_message_id: string | null;
    chat_id: string | null;
  }>("select * from pending_inbound where channel = 'linq' and status = 'new' order by created_at asc limit 10");
  if (rows.length === 0) return;
  const linq = createLinqChannel();
  for (const row of rows) {
    // Claim atomically so overlapping passes don't double-process.
    const claimed = await query<{ id: string }>(
      "update pending_inbound set status = 'done' where id = $1 and status = 'new' returning id",
      [row.id],
    );
    if (claimed.length === 0) continue;
    // Seed the chat mapping from the webhook payload so typing indicators can
    // target this chat, then show "... is typing" while the slow work runs.
    // iMessage-only per Linq (RCS/SMS accept-but-drop); failures are silent.
    if (row.chat_id) linq.noteChat(row.from_handle, row.chat_id);
    const keeper = startTypingKeeper(linq, row.from_handle);
    try {
      const brand = await resolveBrandByLinq(row.from_handle);
      if (!brand) continue;
      const media = Array.isArray(row.media) ? row.media : [];
      const newMedia = await captureMedia(brand.id, linq, media);
      const message = await queryOne<Message>(
        `insert into messages (brand_id, direction, channel, body, media_ids, provider_message_sid)
         values ($1, 'inbound', 'linq', $2, $3::uuid[], $4) returning *`,
        [brand.id, row.body ?? null, newMedia.map((m) => m.id), row.provider_message_id ?? null],
      );
      if (!message) continue;
      if (newMedia.some((m) => m.kind === "photo")) {
        await linq.send({ to: brand.client_phone, body: "Got it, styling your photo and writing your caption, one sec ✨" }).catch(() => {});
      }
      const { reply, mediaUrl } = await processInbound({ brand, message, newMedia });
      if (reply) await linq.send({ to: brand.client_phone, body: reply, mediaUrls: mediaUrl ? [mediaUrl] : undefined });
    } catch (err) {
      console.error(`[discord] linq inbound processing failed for ${row.id}`, err);
      await query("update pending_inbound set status = 'failed' where id = $1", [row.id]).catch(() => {});
    } finally {
      keeper.stop();
    }
  }
}
let linqRunning = false;
setInterval(() => {
  if (linqRunning) return;
  linqRunning = true;
  processLinqInbound()
    .catch((err) => console.error("[discord] linq loop error", err))
    .finally(() => {
      linqRunning = false;
    });
}, 3000);

// ─── Chase: nudge once about a draft left waiting ~24h (daytime only) ────────
async function chasePendingDrafts(): Promise<void> {
  if (!isDaytime(new Date())) return; // never nudge overnight
  const rows = await query<{ id: string; brand_id: string; pillar_name: string | null }>(
    `select p.id, p.brand_id, pl.name as pillar_name
       from posts p
       join brands b on b.id = p.brand_id and b.status = 'active'
       left join pillars pl on pl.id = p.pillar_id
      where p.status = 'pending_approval'
        and p.chased_at is null
        and p.created_at <= now() - interval '24 hours'
        and p.created_at >= now() - interval '7 days'
      order by p.created_at asc
      limit 20`,
  );
  for (const row of rows) {
    // Claim atomically so overlapping passes never double-nudge, and it stays once-only.
    const claimed = await query<{ id: string }>(
      "update posts set chased_at = now() where id = $1 and chased_at is null returning id",
      [row.id],
    );
    if (claimed.length === 0) continue;
    const what = row.pillar_name ? `your ${row.pillar_name} post` : "the post I drafted";
    await sendToBrand(
      row.brand_id,
      chaseNudge(what),
    ).catch((err) => console.error(`[discord] chase send failed for post ${row.id}`, err));
  }
}
let chaseRunning = false;
setInterval(() => {
  if (chaseRunning) return;
  chaseRunning = true;
  chasePendingDrafts()
    .catch((err) => console.error("[discord] chase loop error", err))
    .finally(() => {
      chaseRunning = false;
    });
}, 60 * 60 * 1000);

// ─── Competitor watch: weekly sweep of watched competitors (daytime only) ────
async function sweepCompetitorWatches(): Promise<void> {
  if (!isDaytime(new Date())) return;
  const due = await dueCompetitorWatches();
  for (const watch of due) {
    try {
      const brand = await queryOne<Brand>("select * from brands where id = $1 and status = 'active'", [watch.brand_id]);
      if (!brand) continue;
      const { digest, snapshot } = await competitorWeeklyUpdate(brand, watch);
      await markWatchSwept(watch.id, snapshot);
      if (digest) await sendToBrand(brand.id, `👀 Weekly on ${watch.name}:\n\n${digest}`);
    } catch (err) {
      console.error(`[discord] competitor watch failed for ${watch.id}`, err);
    }
  }
}
let watchRunning = false;
setInterval(() => {
  if (watchRunning) return;
  watchRunning = true;
  sweepCompetitorWatches()
    .catch((err) => console.error("[discord] competitor watch loop error", err))
    .finally(() => {
      watchRunning = false;
    });
}, 6 * 60 * 60 * 1000);

// ─── Niche plan: research pending plans and deliver them to the owner ────────
// The rundown promises a plan "in a couple of minutes", so failure is never
// silent: research retries, falls back to no-search, and if everything fails
// the owner gets an honest holding message (once a day max) while the row
// stays pending for the next attempt.
const PLAN_HOLDING_PREFIX = "Still working on your content plan";
async function holdingRecentlySent(brandId: string): Promise<boolean> {
  const row = await queryOne<{ created_at: string }>(
    `select created_at from messages
      where brand_id = $1 and direction = 'outbound' and body like $2
        and created_at > now() - interval '24 hours'
      order by created_at desc limit 1`,
    [brandId, `${PLAN_HOLDING_PREFIX}%`],
  );
  return !!row;
}
async function buildNichePlans(): Promise<void> {
  const plans = await pendingPlans();
  for (const row of plans) {
    try {
      const brand = await queryOne<Brand>("select * from brands where id = $1", [row.brand_id]);
      if (!brand) { await markPlanFailed(row.id); continue; }
      const plan = await buildPlanWithFallback(brand, row.niche ?? brand.name, row.exemplars ?? null);
      if (!plan) {
        // Everything failed: stay pending for the next attempt (the pending
        // query gates retries to every 15 min), but tell the owner honestly.
        await query("update content_plans set updated_at = now() where id = $1", [row.id]);
        if (!(await holdingRecentlySent(brand.id))) {
          await sendToBrand(brand.id, planHoldingNudge());
        }
        continue;
      }
      await markPlanProposed(row.id, plan);
      const link = `${env.APP_BASE_URL.replace(/\/$/, "")}/app/content-plan`;
      await sendToBrand(
        brand.id,
        `${planTextSummary(plan)}\n\nFull plan → ${link}\n\nReply "yes" and I'll set it all up, or tell me what to tweak.`,
      );
    } catch (err) {
      console.error(`[discord] niche plan build failed for ${row.id}`, err);
      await query("update content_plans set updated_at = now() where id = $1", [row.id]).catch(() => {});
    }
  }
}
let planBuildRunning = false;
setInterval(() => {
  if (planBuildRunning) return;
  planBuildRunning = true;
  buildNichePlans()
    .catch((err) => console.error("[discord] niche plan loop error", err))
    .finally(() => {
      planBuildRunning = false;
    });
}, 30 * 1000);

process.on("unhandledRejection", (err) => {
  console.error("[discord] unhandledRejection", err);
});

client.login(env.DISCORD_BOT_TOKEN);
