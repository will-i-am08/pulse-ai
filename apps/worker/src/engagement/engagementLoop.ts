import {
  query,
  queryOne,
  decryptJson,
  googleAccessToken,
  gbpReplyReview,
} from "@pulse/shared";
import type { Brand, Interaction, InteractionStatus } from "@pulse/shared";
import { getGraphAdapter } from "@pulse/graph";
import type { GraphAdapter } from "@pulse/graph";
import {
  claimInteraction,
  handleInteraction,
  sendToBrand,
} from "@pulse/gateway";
import type { EngagementResult } from "@pulse/gateway";
import { logger } from "../lib/logger.js";

/**
 * Production engagement loop (Phase A) — runs every minute from src/index.ts.
 *
 * Picks up `interactions` rows ingested by the Meta webhook (status 'new'),
 * atomically claims each one (so the Discord bot poller can never
 * double-triage it), runs the orchestrator policy engine, then routes:
 *  - auto-replies + qualified lead answers → posted back to the platform
 *  - drafts + escalations + lead hand-offs → the owner's thread
 *  - spam → hidden on the platform, owner never bothered
 *
 * Failures surface: a reply that can't be posted becomes an owner-thread
 * message with the error, never a silent drop.
 */

const POLL_LIMIT = 20;

/** Negatives in the window that trigger an urgent spike escalation. */
export const SPIKE_WINDOW_MINUTES = 60;
export const SPIKE_THRESHOLD = 3;
export const SPIKE_COOLDOWN_HOURS = 6;
const SPIKE_PREFIX = "🚨 Sentiment spike";

export interface RouteDeps {
  graph: GraphAdapter;
  sendToBrand: (brandId: string, body: string) => Promise<void>;
  replyGoogleReview: (brand: Brand, interaction: Interaction, body: string) => Promise<void>;
}

export interface EngagementLoopDeps extends RouteDeps {
  claim: typeof claimInteraction;
  triage: typeof handleInteraction;
  now: () => Date;
}

/** Post/update the reply to a Google review via the GBP API. */
export async function replyGoogleReview(
  brand: Brand,
  interaction: Interaction,
  body: string,
): Promise<void> {
  if (!brand.google_tokens_encrypted) {
    throw new Error(`Brand ${brand.id} has no Google Business Profile connected`);
  }
  if (!interaction.external_id) {
    throw new Error(`Interaction ${interaction.id} has no review name to reply to`);
  }
  const { refresh_token } = decryptJson<{ refresh_token: string }>(brand.google_tokens_encrypted);
  const token = await googleAccessToken(refresh_token);
  await gbpReplyReview(token, interaction.external_id, body);
}

function labelFor(interaction: Interaction): string {
  const who = interaction.author ? ` from ${interaction.author}` : "";
  return `${interaction.kind} on ${interaction.platform}${who}`;
}

/**
 * Route one triaged interaction: post the public reply (if any) and deliver
 * the owner message (if any). `status` is the fresh row status written by
 * handleInteraction.
 */
export async function routeEngagementResult(
  brand: Brand,
  interaction: Interaction,
  status: InteractionStatus,
  res: EngagementResult,
  deps: RouteDeps,
): Promise<void> {
  if (res.ownerMessage) {
    await deps.sendToBrand(brand.id, res.ownerMessage);
  }

  if (status === "hidden") {
    // Spam: remove it from public view. Best-effort — the row is already
    // hidden locally, so a platform failure is logged, not owner-pinging.
    try {
      await deps.graph.hide?.({ brand, interaction });
    } catch (err) {
      logger.error(`engagement loop: hide failed for interaction ${interaction.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return;
  }

  if (!res.publicReply) return;

  // Auto-approved reply (or qualified lead answer): post it back.
  try {
    let externalReplyId: string | null = null;
    if (interaction.platform === "google") {
      await deps.replyGoogleReview(brand, interaction, res.publicReply);
    } else if (deps.graph.reply) {
      const posted = await deps.graph.reply({ brand, interaction, body: res.publicReply });
      externalReplyId = posted.externalReplyId;
    } else {
      throw new Error("active graph adapter cannot post replies");
    }
    if (externalReplyId) {
      await query(
        `update interaction_replies set external_reply_id = $1
          where id = (
            select id from interaction_replies
            where interaction_id = $2 and status = 'sent'
            order by created_at desc limit 1
          )`,
        [externalReplyId, interaction.id],
      ).catch(() => undefined);
    }
    logger.info(`engagement loop: replied to ${labelFor(interaction)} for brand ${brand.id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`engagement loop: reply failed for interaction ${interaction.id}`, { error: message });
    await deps.sendToBrand(
      brand.id,
      `⚠️ Tried to reply to that ${labelFor(interaction)} but posting failed (${message}). The text I wanted to send:\n\n"${res.publicReply}"`,
    );
  }
}

export function buildSpikeAlert(brandName: string, count: number): string {
  return (
    `${SPIKE_PREFIX} on "${brandName}": ${count} negative comments/reviews in the last hour. ` +
    `This looks like more than one grumpy customer — possible PR issue. ` +
    `Say the word and I'll pull the full list.`
  );
}

async function recentNegativeCount(brandId: string, sinceIso: string): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*) as count from interactions
      where brand_id = $1 and sentiment = 'negative' and created_at >= $2`,
    [brandId, sinceIso],
  );
  return Number(rows[0]?.count ?? 0);
}

async function recentSpikeAlertAt(brandId: string, sinceIso: string): Promise<string | null> {
  const rows = await query<{ created_at: string }>(
    `select created_at from messages
      where brand_id = $1 and direction = 'outbound' and body like $2
      order by created_at desc limit 1`,
    [brandId, `${SPIKE_PREFIX}%`],
  );
  const at = rows[0]?.created_at ?? null;
  return at && at >= sinceIso ? at : null;
}

/**
 * Sentiment-spike detection: a *surge* of negativity (not one bad comment)
 * gets an urgent escalation. Cooldown prevents repeat pings for the same wave.
 */
export async function checkSentimentSpike(
  brand: Brand,
  deps: Pick<RouteDeps, "sendToBrand"> & { now: () => Date },
): Promise<void> {
  const nowMs = deps.now().getTime();
  const windowSince = new Date(nowMs - SPIKE_WINDOW_MINUTES * 60 * 1000).toISOString();
  const count = await recentNegativeCount(brand.id, windowSince);
  if (count < SPIKE_THRESHOLD) return;

  const cooldownSince = new Date(nowMs - SPIKE_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
  if (await recentSpikeAlertAt(brand.id, cooldownSince)) {
    logger.info(`engagement loop: spike still active for brand ${brand.id}, cooldown holds`);
    return;
  }
  await deps.sendToBrand(brand.id, buildSpikeAlert(brand.name, count));
}

function realDeps(): EngagementLoopDeps {
  return {
    graph: getGraphAdapter(),
    sendToBrand,
    replyGoogleReview,
    claim: claimInteraction,
    triage: handleInteraction,
    now: () => new Date(),
  };
}

/** Poll 'new' interactions, claim + triage + route each, then spike-check brands. */
export async function runEngagementLoop(deps: EngagementLoopDeps = realDeps()): Promise<void> {
  let news: Interaction[];
  try {
    news = await query<Interaction>(
      `select * from interactions where status = 'new' order by created_at asc limit $1`,
      [POLL_LIMIT],
    );
  } catch (err) {
    logger.error("engagement loop: failed to poll new interactions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (news.length === 0) return;

  const spiked = new Set<string>();
  for (const it of news) {
    let claimed: Interaction | null;
    try {
      claimed = await deps.claim(it.id);
    } catch (err) {
      logger.error(`engagement loop: claim failed for interaction ${it.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!claimed) continue; // another consumer got there first

    const brand = await queryOne<Brand>(`select * from brands where id = $1`, [claimed.brand_id]).catch(
      () => null,
    );
    if (!brand || brand.status !== "active") {
      await query(`update interactions set status = 'resolved' where id = $1`, [claimed.id]).catch(
        () => undefined,
      );
      continue;
    }

    let res: EngagementResult;
    try {
      res = await deps.triage(brand, claimed);
    } catch (err) {
      logger.error(`engagement loop: triage failed for interaction ${claimed.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      // Release the claim so a transient failure retries next tick instead of
      // stranding the row in 'triaging' forever.
      await query(`update interactions set status = 'new' where id = $1`, [claimed.id]).catch(
        () => undefined,
      );
      continue;
    }

    const fresh = await queryOne<Pick<Interaction, "status">>(
      `select status from interactions where id = $1`,
      [claimed.id],
    ).catch(() => null);

    try {
      await routeEngagementResult(brand, claimed, fresh?.status ?? "resolved", res, deps);
    } catch (err) {
      logger.error(`engagement loop: routing failed for interaction ${claimed.id}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!spiked.has(brand.id)) {
      spiked.add(brand.id);
      try {
        await checkSentimentSpike(brand, deps);
      } catch (err) {
        logger.error(`engagement loop: spike check failed for brand ${brand.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
