/**
 * Shared deps for proactive loops — imported from gateway/orchestrator so tests
 * can swap them if needed, and so we don't re-export the whole orchestrator
 * barrel from every loop file.
 */
export { sendToBrand, createLinqChannel, resolveBrandByLinq, captureMedia, startTypingKeeper } from "@pulse/gateway";
export {
  gapNudgeMessage,
  chooseNextFormat,
  pickFreshPhoto,
  pickFreshPhotos,
  draftPostFromPhoto,
  draftCarouselFromPhotos,
  draftStoryFromPhoto,
  draftReelFromStills,
  videoEditFallbackSms,
  generateTipCarousel,
  generateTypedCarousel,
  runAiVideoJobDrain,
  isDaytime,
  dueCompetitorWatches,
  competitorWeeklyUpdate,
  markWatchSwept,
  pendingPlans,
  buildPlanWithFallback,
  markPlanProposed,
  markPlanFailed,
  planTextSummary,
  planOverrunNudge,
  ONBOARDING_PLAN_ETA_MINUTES,
  buildPerformanceDigest,
  processInbound,
  brandsDueForConnectNudge,
  markConnectNudgeSent,
  clearSkippedConnectFlags,
} from "@pulse/orchestrator";
