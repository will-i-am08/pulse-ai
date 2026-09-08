import cron from "node-cron";
import { getServerEnv } from "@pulse/shared";
import { logger } from "./lib/logger.js";
import { runPublishLoop } from "./publish/publishLoop.js";
import { runTriggerLoop } from "./triggers/triggerLoop.js";
import { runEngagementLoop } from "./engagement/engagementLoop.js";
import { runReviewSync } from "./engagement/reviewSync.js";

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
        // Reviews poll slowly (hourly-grade data): fold the sync into every
        // 15th engagement tick so it shares the cron and the shutdown path.
        if (new Date().getMinutes() % 15 === 0) {
          await runReviewSync();
        }
        await runEngagementLoop();
      } catch (err) {
        logger.error("engagement loop crashed", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
      } finally {
        engaging = false;
      }
    },
    { timezone: env.TZ }
  );

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down gracefully`);
    publishTask.stop();
    triggerTask.stop();
    engagementTask.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("worker ready — publish, trigger, and engagement loops scheduled every minute");
}

main().catch((err) => {
  logger.error("worker failed to start", { error: err instanceof Error ? err.stack ?? err.message : String(err) });
  process.exit(1);
});
