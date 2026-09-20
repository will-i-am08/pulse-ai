import cron from "node-cron";
import { getServerEnv } from "@pulse/shared";
import { logger } from "./lib/logger.js";
import { runPublishLoop } from "./publish/publishLoop.js";
import { runTriggerLoop } from "./triggers/triggerLoop.js";
import { runEngagementLoop } from "./engagement/engagementLoop.js";
import { runVoiceLoop } from "./voice/voiceLoop.js";
import { deliverPendingLoginCodes } from "@pulse/gateway";
import { runGapFillLoop } from "./proactive/gapFill.js";
import { runChaseLoop } from "./proactive/chase.js";
import { runCompetitorWatchLoop } from "./proactive/competitorWatch.js";
import { runNichePlanLoop } from "./proactive/nichePlan.js";
import { runConnectNudgeLoop } from "./proactive/connectNudge.js";
import { runWeeklyDigestLoop } from "./proactive/weeklyDigest.js";
import { runEventFollowupLoop } from "./proactive/eventFollowup.js";
import { runEngagementLearnLoop } from "./proactive/engagementLearn.js";
import { runLinqInboundLoop } from "./proactive/linqInbound.js";
import { runAiVideoLoop } from "./proactive/aiVideoLoop.js";
import { runKickoffLoop, runKickoffReaperLoop } from "./proactive/kickoffLoop.js";
import { runAutonomyLoop } from "./proactive/autonomyLoop.js";
import { runRetentionPurgeLoop } from "./proactive/retention.js";
import { runAdsSyncLoop } from "./proactive/adsSync.js";
import { runCreativeRefreshLoop } from "./proactive/creativeRefresh.js";

/**
 * Ceiling on a single tick. The `running` flag only clears when the promise
 * SETTLES, and callLLM sets no timeout/AbortSignal — so one hung socket wedged
 * a loop for the lifetime of the process ("previous tick still running,
 * skipping" every 30s, forever). Generous on purpose: this does not cancel the
 * hung work, it only lets the next tick start, so a slow-but-healthy tick that
 * trips it will overlap with its successor.
 */
const TICK_TIMEOUT_MS = 15 * 60 * 1000;

/** Reject (without cancelling) once a tick has clearly hung. */
function withTickTimeout(name: string, ms: number, p: Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${name}: tick exceeded ${ms}ms — abandoning so the loop can run again`)),
      ms,
    );
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Overlap-safe interval runner — skips if the previous tick is still in flight. */
function guardedInterval(
  name: string,
  ms: number,
  fn: () => Promise<void>,
  opts?: { runSoonMs?: number; timeoutMs?: number },
): ReturnType<typeof setInterval> {
  let running = false;
  const timeoutMs = opts?.timeoutMs ?? TICK_TIMEOUT_MS;
  const tick = () => {
    if (running) {
      logger.warn(`${name}: previous tick still running, skipping`);
      return;
    }
    running = true;
    withTickTimeout(name, timeoutMs, fn())
      .catch((err) =>
        logger.error(`${name} crashed`, {
          error: err instanceof Error ? err.stack ?? err.message : String(err),
        }),
      )
      .finally(() => {
        running = false;
      });
  };
  if (opts?.runSoonMs != null) setTimeout(tick, opts.runSoonMs);
  return setInterval(tick, ms);
}

async function main(): Promise<void> {
  const env = getServerEnv(); // fail fast on missing/invalid config
  logger.info(`worker starting (GRAPH_MODE=${env.GRAPH_MODE}, MESSAGE_CHANNEL=${env.MESSAGE_CHANNEL}, tz=${env.TZ})`);

  let publishing = false;
  const publishTask = cron.schedule(
    "* * * * *",
    async () => {
      if (publishing) {
        logger.warn("publish loop: previous tick still running, skipping this tick");
        return;
      }
      publishing = true;
      try {
        await runPublishLoop();
      } catch (err) {
        logger.error("publish loop crashed", {
          error: err instanceof Error ? err.stack ?? err.message : String(err),
        });
      } finally {
        publishing = false;
      }
    },
    { timezone: env.TZ },
  );

  let triggering = false;
  const triggerTask = cron.schedule(
    "* * * * *",
    async () => {
      if (triggering) {
        logger.warn("trigger loop: previous tick still running, skipping this tick");
        return;
      }
      triggering = true;
      try {
        await runTriggerLoop();
      } catch (err) {
        logger.error("trigger loop crashed", {
          error: err instanceof Error ? err.stack ?? err.message : String(err),
        });
      } finally {
        triggering = false;
      }
    },
    { timezone: env.TZ },
  );

  let engaging = false;
  const engagementTask = cron.schedule(
    "* * * * *",
    async () => {
      if (engaging) {
        logger.warn("engagement loop: previous tick still running, skipping this tick");
        return;
      }
      engaging = true;
      try {
        await runEngagementLoop();
      } catch (err) {
        logger.error("engagement loop crashed", {
          error: err instanceof Error ? err.stack ?? err.message : String(err),
        });
      } finally {
        engaging = false;
      }
    },
    { timezone: env.TZ },
  );

  let analysingVoice = false;
  const voiceTask = cron.schedule(
    "* * * * *",
    async () => {
      if (analysingVoice) {
        logger.warn("voice loop: previous tick still running, skipping this tick");
        return;
      }
      analysingVoice = true;
      try {
        await runVoiceLoop();
      } catch (err) {
        logger.error("voice loop crashed", {
          error: err instanceof Error ? err.stack ?? err.message : String(err),
        });
      } finally {
        analysingVoice = false;
      }
    },
    { timezone: env.TZ },
  );

  // Passwordless-login code delivery via SMS / Linq.
  let deliveringCodes = false;
  const loginCodeTimer = setInterval(() => {
    if (deliveringCodes) return;
    deliveringCodes = true;
    deliverPendingLoginCodes()
      .then((n) => {
        if (n > 0) logger.info(`delivered ${n} login code(s)`);
      })
      .catch((err) =>
        logger.error("login-code delivery crashed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      .finally(() => {
        deliveringCodes = false;
      });
  }, 4000);

  // Proactive SMS loops (moved off Discord).
  const gapFillTimer = guardedInterval("gap-fill", 2 * 60 * 60 * 1000, runGapFillLoop, {
    runSoonMs: 20_000,
  });
  const chaseTimer = guardedInterval("chase", 60 * 60 * 1000, runChaseLoop);
  const watchTimer = guardedInterval("competitor-watch", 6 * 60 * 60 * 1000, runCompetitorWatchLoop);
  const planTimer = guardedInterval("niche-plan", 30 * 1000, runNichePlanLoop);
  const connectNudgeTimer = guardedInterval("connect-nudge", 60 * 60 * 1000, runConnectNudgeLoop, {
    runSoonMs: 45_000,
  });
  const digestTimer = guardedInterval("weekly-digest", 60 * 60 * 1000, runWeeklyDigestLoop);

  // Episodic event follow-up — "how'd the Emily Calder shoot go?" once an event
  // the owner mentioned has passed. Flag-gated (KIP_EVENT_FOLLOWUP=on).
  const eventFollowupTimer = guardedInterval("event-followup", 30 * 60 * 1000, runEventFollowupLoop, {
    runSoonMs: 60_000,
  });

  // Daily engagement-learning pass (Phase 3) — flag-gated (KIP_ENGAGEMENT_LEARN),
  // log-only until 'on'. Long period; overlap-safe via guardedInterval.
  const engagementLearnTimer = guardedInterval("engagement-learn", 24 * 60 * 60 * 1000, runEngagementLearnLoop, {
    runSoonMs: 300_000,
  });

  // Linq inbound drain — only meaningful when MESSAGE_CHANNEL=linq, but cheap to poll.
  const linqTimer = guardedInterval("linq-inbound", 3000, runLinqInboundLoop);

  // AI video job drain (Phase G4) — texts when Kling/Runway jobs finish.
  const aiVideoTimer = guardedInterval("ai-video", 45_000, runAiVideoLoop, {
    runSoonMs: 25_000,
  });

  // Kip self-kickoffs — user asks, Kip commits, or proactive autonomy.
  const kickoffTimer = guardedInterval("kip-kickoffs", 30_000, runKickoffLoop, {
    runSoonMs: 15_000,
  });
  // Reaping runs on its OWN interval. It used to live only inside the drain, so
  // a wedged drain loop meant nothing ever reclaimed — and the partial unique
  // index on (brand_id, kind) where status in ('queued','running') then told
  // the client "Already on that" forever, with nothing ever arriving.
  const kickoffReaperTimer = guardedInterval("kip-kickoff-reaper", 60_000, runKickoffReaperLoop, {
    runSoonMs: 10_000,
    timeoutMs: 60_000,
  });
  // Proactive trend scouting (daytime) — queues kickoffs the drain loop delivers.
  const autonomyTimer = guardedInterval("kip-autonomy", 6 * 60 * 60 * 1000, runAutonomyLoop, {
    runSoonMs: 120_000,
  });

  // Meta ads insights + spend-cap enforcement (Phase F).
  const adsSyncTimer = guardedInterval("ads-sync", 30 * 60 * 1000, runAdsSyncLoop, {
    runSoonMs: 60_000,
  });

  // Weekly creative refresh — library photo → 3 look variants → SMS pick.
  const creativeRefreshTimer = guardedInterval(
    "creative-refresh",
    6 * 60 * 60 * 1000,
    runCreativeRefreshLoop,
    { runSoonMs: 180_000 },
  );

  // Weekly data retention purge (design_memory + research_snapshots > RETENTION_DAYS).
  // Cron: Mondays 03:15 local — cheap, overlap-safe via guardedInterval on a long period.
  const retentionTimer = guardedInterval(
    "retention-purge",
    7 * 24 * 60 * 60 * 1000,
    runRetentionPurgeLoop,
    { runSoonMs: 90_000 },
  );

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down gracefully`);
    publishTask.stop();
    triggerTask.stop();
    engagementTask.stop();
    voiceTask.stop();
    clearInterval(loginCodeTimer);
    clearInterval(gapFillTimer);
    clearInterval(chaseTimer);
    clearInterval(watchTimer);
    clearInterval(planTimer);
  clearInterval(connectNudgeTimer);
    clearInterval(digestTimer);
    clearInterval(eventFollowupTimer);
    clearInterval(engagementLearnTimer);
    clearInterval(linqTimer);
    clearInterval(aiVideoTimer);
    clearInterval(kickoffTimer);
    clearInterval(kickoffReaperTimer);
    clearInterval(autonomyTimer);
    clearInterval(adsSyncTimer);
    clearInterval(creativeRefreshTimer);
    clearInterval(retentionTimer);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info(
    "worker ready — publish, trigger, engagement, voice, gap-fill, chase, competitor watch, niche plan, weekly digest, linq inbound, ai-video, kip-kickoffs, kip-autonomy, ads-sync, creative-refresh, retention",
  );
}

main().catch((err) => {
  logger.error("worker failed to start", {
    error: err instanceof Error ? err.stack ?? err.message : String(err),
  });
  process.exit(1);
});
