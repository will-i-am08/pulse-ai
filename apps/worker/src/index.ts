import cron from "node-cron";
import { getServerEnv } from "@pulse/shared";
import { logger } from "./lib/logger.js";
import { runPublishLoop } from "./publish/publishLoop.js";
import { runTriggerLoop } from "./triggers/triggerLoop.js";
import { runEngagementLoop } from "./engagement/engagementLoop.js";
import { runVoiceLoop } from "./voice/voiceLoop.js";
import { deliverPendingLoginCodes } from "@pulse/gateway";

async function main(): Promise<void> {
  const env = getServerEnv(); // fail fast on missing/invalid config
  logger.info(`worker starting (GRAPH_MODE=${env.GRAPH_MODE}, tz=${env.TZ})`);

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
        logger.error("publish loop crashed", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
      } finally {
        publishing = false;
      }
    },
    { timezone: env.TZ }
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
        logger.error("trigger loop crashed", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
      } finally {
        triggering = false;
      }
    },
    { timezone: env.TZ }
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
        logger.error("engagement loop crashed", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
      } finally {
        engaging = false;
      }
    },
    { timezone: env.TZ }
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
        logger.error("voice loop crashed", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
      } finally {
        analysingVoice = false;
      }
    },
    { timezone: env.TZ }
  );

  // Passwordless-login code delivery. The bot owns the Discord channel and
  // delivers there; the worker owns SMS/Linq, so it delivers only then (avoids
  // a double-send, and activeChannel() would throw for discord here anyway).
  let loginCodeTimer: ReturnType<typeof setInterval> | null = null;
  if (env.MESSAGE_CHANNEL !== "discord") {
    let deliveringCodes = false;
    loginCodeTimer = setInterval(() => {
      if (deliveringCodes) return;
      deliveringCodes = true;
      deliverPendingLoginCodes()
        .then((n) => {
          if (n > 0) logger.info(`delivered ${n} login code(s)`);
        })
        .catch((err) => logger.error("login-code delivery crashed", { error: err instanceof Error ? err.message : String(err) }))
        .finally(() => {
          deliveringCodes = false;
        });
    }, 4000);
  }

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down gracefully`);
    publishTask.stop();
    triggerTask.stop();
    engagementTask.stop();
    voiceTask.stop();
    if (loginCodeTimer) clearInterval(loginCodeTimer);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("worker ready — publish, trigger, engagement, and voice loops scheduled every minute");
}

main().catch((err) => {
  logger.error("worker failed to start", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
