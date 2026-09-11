export { processInbound } from "./processInbound.js";
export type { InboundContext } from "./processInbound.js";

export { draftCaption } from "./draftCaption.js";
export type { DraftCaptionResult } from "./draftCaption.js";

export { applyCorrection } from "./applyCorrection.js";

export { seedBrandVoice } from "./seedBrandVoice.js";

export { buildConversationContext } from "./conversationContext.js";

export {
  startOnboarding,
  onboardingTurn,
  onboardingNext,
  finishOnboarding,
  WRAP_ACK,
  restartOnboarding,
  archiveLabChatAndRestart,
  listLabChats,
  hardResetLabBrand,
  ensureOwnerNameFromUser,
  extractVisualHintsFromHtml,
  seedVisualProfileFromWebsite,
} from "./onboarding.js";
export type { LabChatSummary } from "./onboarding.js";

export { ownerFirstName, firstNameFromDisplayName, personaLines, connectionSummary } from "./persona.js";

export { runVoiceAnalysis, queueVoiceAnalysis } from "./voice/analyzeVoice.js";
export { computeTextStats } from "./voice/textStats.js";
export type { TextStats } from "./voice/textStats.js";

export { callLLM } from "./llm.js";
export type { CallLLMOptions } from "./llm.js";

export { classifyInbound, ruleBasedClassify, InboundClassification } from "./classify.js";
export type { ClassifyResult } from "./classify.js";

export { ensurePillars, listPillars, classifyPhotoPillar, configurePillarsFromMessage, DEFAULT_PILLARS } from "./pillars.js";
export { scheduleSlot } from "./scheduler.js";
export { generateFillerPost, recentlyPingedPillar } from "./fillers.js";
export { pickFreshPhoto, pickFreshPhotos, pickReusablePhoto, bankedPhotoCount, draftPostFromPhoto, visualReference } from "./library.js";
export { gapNudgeMessage } from "./nudges.js";
export {
  chooseNextFormat,
  generateTipCarousel,
  generateTypedCarousel,
  draftCarouselFromPhotos,
  draftStoryFromPhoto,
  draftStoryOverlay,
  classifyStoryTone,
  weightsFromFormatMix,
  carouselDecision,
} from "./formats.js";
export type { TypedCarouselKind } from "./formats.js";
export {
  proposeCampaign,
  activateCampaign,
  getProposedCampaign,
  getLiveCampaign,
  hasActivePausingCampaign,
  looksLikeCampaignControl,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
} from "./campaigns.js";
export { updateFactsFromMessage, looksLikeBusinessFact, factsForPrompt } from "./businessProfile.js";
export {
  looksLikeBrandContextUpdate,
  detectBrandContextKind,
  updateBrandContextFromMessage,
  brandContextForPrompt,
  mergeIcp,
  mergePainPoints,
  mergePositioning,
  mergeOffers,
  mergeVisual,
  researchIcp,
  researchPainPoints,
  proposePositioning,
  saveIcpDraft,
  savePainPointsDraft,
  savePositioningDraft,
} from "./brandContext.js";
export {
  storeDesignMemoryRef,
  listRecentDesignMemory,
  listTopDesignMemory,
  updateDesignMemoryStatus,
} from "./designMemory.js";
export {
  resolveBrandPalette,
  renderQuoteCard,
  editImageForBrand,
  applyTextTile,
  applyStoryCreative,
  shouldOverlayHeadline,
  messageWantsText,
  brandPhotoStyleBits,
  gradePhotoBundle,
} from "./imaging.js";
export {
  composeSlide,
  composeAndStoreSlide,
  gatherDesignContext,
  pickLayoutVariant,
  layoutForIndex,
  rolesForCarouselKind,
} from "./designComposer.js";
export type { LayoutPrimitive, SlideRole, DesignContext } from "./designComposer.js";
export { runDesignQa, ensureDesignQa, heuristicDesignQa, designQaFailureSms } from "./designQa.js";
export { routeImageJob, specialtyReplicateGenerate } from "./modelRouter.js";
export type { ImageJob, ImageEngine, RouteDecision } from "./modelRouter.js";
export { mapWithConcurrency, SLIDE_RENDER_CONCURRENCY } from "./concurrency.js";
export { createInteraction, claimInteraction, handleInteraction, sendLatestDraft, editLatestDraft, latestDraftedInteraction } from "./engagement.js";
export type { EngagementResult } from "./engagement.js";
export { repurposeUrl } from "./repurpose.js";
export {
  seedPendingPlan,
  pendingPlans,
  getProposedPlan,
  getAcceptedPlan,
  researchNichePlan,
  researchNichePlanFallback,
  buildPlanWithFallback,
  markPlanProposed,
  markPlanFailed,
  planTextSummary,
  applyNichePlan,
  looksLikeContentPlanRequest,
  proposeContentPlanFromSms,
} from "./nichePlan.js";
export {
  competitorIntel,
  extractCompetitorName,
  addCompetitorWatch,
  listCompetitorWatches,
  dueCompetitorWatches,
  competitorWeeklyUpdate,
  markWatchSwept,
} from "./competitors.js";
export {
  isBlockedHost,
  safePublicUrl,
  detectResearchFocus,
  runDeepResearch,
  saveResearchSnapshot,
  listRecentSnapshots,
  storeVisualExemplars,
  listVisualExemplars,
  persistCompetitorResearch,
} from "./research.js";
export type { ResearchFocus } from "./research.js";
export {
  looksLikeStrategyRequest,
  getProposedStrategyBrief,
  proposeStrategyBrief,
  parseStrategyAccept,
  looksLikeStrategyRevise,
  acceptStrategyPieces,
  reviseStrategyBrief,
  cancelStrategyBrief,
} from "./strategyBrief.js";
export type { StrategyPieceKey } from "./strategyBrief.js";
export {
  analyzePerformance,
  aggregateAdMetrics,
  summarizePaidMetrics,
} from "./insights.js";
export type {
  PostPerf,
  PaidDigestMetrics,
  PerformanceAnalysis,
  PerfSuggestion,
  OrganicWinner,
} from "./insights.js";
export {
  buildPerformanceDigest,
  buildPerformanceAnalysis,
  fetchPaidDigestMetrics,
} from "./performanceDigest.js";
export {
  looksLikeDigestRequest,
  looksLikeMakeMore,
  looksLikeAnalystBoost,
  looksLikePerfConfirm,
  isAdsEnabled,
  isAdsConnected,
  applyMakeMoreOfThese,
  handoffBoostOrCampaign,
  confirmPerfSuggestion,
  getPerfPending,
  savePerfPending,
  clearPerfPending,
  queueAdsRecommendation,
} from "./performanceActions.js";
export type { PerfPendingAction } from "./performanceActions.js";
export { connectLinkMessage, metaConnectStatusMessage, isMetaConnected } from "./smsConnect.js";
export { gapInfo, lastInteractionAt, mostRecentActionable, isDaytime } from "./reengagement.js";
export type { GapInfo, GapBucket, Actionable, ActionableKind } from "./reengagement.js";
export { renderFeedMockup, renderStoryMockup, storeMockup, foldCaption, previewUrlForPost } from "./mockup.js";
export type { MockupInput } from "./mockup.js";
export {
  parseDestinationChoice,
  slicesForApproval,
  buildPlatformCaptions,
  fitCaption,
  CAPTION_LIMITS,
  DEST_HINT,
} from "./destinations.js";

// Phase G — Video & AI generation
export {
  detectFfmpeg,
  resetFfmpegCache,
  validateReelVideo,
  extractVideoFrames,
  lightEditVideo,
  motionFromStills,
  draftReelFromVideo,
  draftReelFromStills,
  videoEditFallbackSms,
  storeVideoAsset,
  REEL_MAX_BYTES,
  REEL_MAX_DURATION_SEC,
} from "./video.js";
export type { FfmpegAvailability, VideoProbe, VideoValidation, LightEditOpts } from "./video.js";
export {
  looksLikeAiVideoRequest,
  looksLikeMakeReelRequest,
  routeAiVideo,
  aiVideoConfigured,
  queueAiVideoJob,
  processAiVideoJob,
  runAiVideoJobDrain,
} from "./aiVideo.js";
export type { AiVideoProvider, AiVideoRoute, QueueAiVideoResult } from "./aiVideo.js";
export type { DraftCaptionOpts } from "./draftCaption.js";

