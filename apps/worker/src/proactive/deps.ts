/**
 * Shared deps for proactive loops — imported from gateway/orchestrator so tests
 * can swap them if needed, and so we don't re-export the whole orchestrator
 * barrel from every loop file.
 */
export {
  sendToBrand,
  createLinqChannel,
  resolveBrandByLinq,
  captureMedia,
  startTypingKeeper,
  handleUnknownInbound,
} from "@pulse/gateway";
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
  runKickoffDrain,
  reclaimStaleKickoffs,
  runAutonomyPass,
  maybeEnqueueCompetitorDraft,
  isDaytime,
  dueCompetitorWatches,
  competitorWeeklyUpdate,
  markWatchSwept,
  pendingPlans,
  buildPlanWithFallback,
  markPlanProposed,
  markPlanFailed,
  buildPerformanceDigest,
  processInbound,
  brandsDueForConnectNudge,
  markConnectNudgeSent,
  clearSkippedConnectFlags,
  runCreativeRefreshPass,
} from "@pulse/orchestrator";
