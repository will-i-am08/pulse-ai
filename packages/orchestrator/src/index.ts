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
  draftCarouselFromPhotos,
  draftStoryFromPhoto,
  classifyStoryTone,
} from "./formats.js";
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
export { resolveBrandPalette, renderQuoteCard, editImageForBrand, applyTextTile } from "./imaging.js";
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
export { analyzePerformance } from "./insights.js";
export type { PostPerf } from "./insights.js";
export { buildPerformanceDigest } from "./performanceDigest.js";
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

