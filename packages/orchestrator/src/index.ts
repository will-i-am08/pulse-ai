export { processInbound } from "./processInbound.js";
export type { InboundContext } from "./processInbound.js";

export { draftCaption } from "./draftCaption.js";
export type { DraftCaptionResult } from "./draftCaption.js";

export { applyCorrection } from "./applyCorrection.js";

export { seedBrandVoice } from "./seedBrandVoice.js";

export { buildConversationContext } from "./conversationContext.js";

export {
  startOnboarding,
  kickOffOnboardingAfterPayment,
  beginOnboardingInterview,
  onChannelsConnectedDuringOnboarding,
  continueOnboardingAfterVoiceAnalysis,
  handleAwaitingConnect,
  handleAwaitingContact,
  handleReadingContent,
  looksLikeSkipConnect,
  looksLikeDoneReply,
  looksLikeUnsureReply,
  craftHumanAck,
  replyAlreadyAcked,
  stripLeadingAck,
  acknowledgeThenContinue,
  sendConnectLinkAfterContact,
  onboardingTurn,
  onboardingNext,
  finishOnboarding,
  type OnboardingRundown,
  WRAP_ACK,
  restartOnboarding,
  archiveLabChatAndRestart,
  listLabChats,
  hardResetLabBrand,
  ensureOwnerNameFromUser,
  extractVisualHintsFromHtml,
  seedVisualProfileFromWebsite,
} from "./onboarding.js";
export {
  brandsDueForConnectNudge,
  connectNudgeMessage,
  markConnectNudgeSent,
  clearSkippedConnectFlags,
} from "./connectNudge.js";
export type { ConnectNudgeCandidate } from "./connectNudge.js";

export type { LabChatSummary } from "./onboarding.js";

export { ownerFirstName, firstNameFromDisplayName, personaLines, connectionSummary } from "./persona.js";

export {
  runVoiceAnalysis,
  queueVoiceAnalysis,
  drainVoiceAnalysisForBrand,
  reclaimStaleVoiceJobs,
} from "./voice/analyzeVoice.js";
export { computeTextStats } from "./voice/textStats.js";
export type { TextStats } from "./voice/textStats.js";

export { callLLM } from "./llm.js";
export type { CallLLMOptions } from "./llm.js";

export {
  classifyInbound,
  ruleBasedClassify,
  looksLikeAffirmation,
  InboundClassification,
} from "./classify.js";
export type { ClassifyResult } from "./classify.js";

export {
  looksLikePhotoBackgroundAsk,
  looksLikePhotoVisualsAsk,
  looksLikeDesignedVisualsAsk,
  inferVisualModeFromText,
} from "./visualMode.js";

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
export { routeImageJob, specialtyReplicateGenerate, specialtyCostSmsHint } from "./modelRouter.js";
export type { ImageJob, ImageEngine, RouteDecision } from "./modelRouter.js";
export { mapWithConcurrency, SLIDE_RENDER_CONCURRENCY, DRAFT_CONCURRENCY } from "./concurrency.js";
export {
  createInteraction,
  claimInteraction,
  handleInteraction,
  sendLatestDraft,
  editLatestDraft,
  latestDraftedInteraction,
  sendDraftInstead,
  claimLatestLead,
  markLatestAsSpam,
  maybeAutoPushLead,
} from "./engagement.js";
export type { EngagementResult } from "./engagement.js";
export {
  resolveDestinationLink,
  resolveAdDestinationUrl,
  getPendingDestinationLink,
  looksLikeDestinationLinkIntent,
  looksLikeLinkConfirmYes,
  looksLikeLinkConfirmNo,
  extractUrlFromMessage,
  discoverBookingLinks,
  saveConfirmedDestinationLink,
  clearPendingDestinationLink,
  setPendingDestinationLink,
  confirmationSms,
  ensureDestinationLink,
  handleDestinationLinkConfirmation,
  platformForbidsCaptionUrl,
  defaultLinkKeyword,
  buildLinkOffer,
  applyLinkOfferToCaption,
  storyLinkCta,
  matchesLinkOfferRequest,
  loadPostForInteraction,
  privateLinkDmBody,
  publicLinkAckReply,
} from "./destinationLinks.js";
export type { DiscoveredLink, DestinationLinkContext } from "./destinationLinks.js";
export {
  buildLeadCard,
  formatLeadCardSms,
  inferLeadIntent,
  suggestLeadNextStep,
} from "./leadCard.js";
export type { LeadCard, LeadCardInput } from "./leadCard.js";
export {
  pushLeadToCrm,
  setCrmWebhookUrl,
  clearCrmWebhookUrl,
  getCrmWebhookUrl,
  isValidCrmWebhookUrl,
  sendLeadEmailFallback,
  latestEscalatedLead,
  latestActionableInteraction,
} from "./crmWebhook.js";
export type { CrmPushResult, CrmPushTrigger, PushLeadOptions } from "./crmWebhook.js";
export { repurposeUrl } from "./repurpose.js";
export {
  seedPendingPlan,
  pendingPlans,
  getProposedPlan,
  getAcceptedPlan,
  researchNichePlan,
  researchNichePlanFallback,
  buildPlanWithFallback,
  buildOnboardingPlanSms,
  planOverrunNudge,
  ONBOARDING_PLAN_ETA_MINUTES,
  PLAN_WEB_SEARCH_DEEP,
  PLAN_WEB_SEARCH_HYBRID,
  markPlanProposed,
  markPlanFailed,
  planTextSummary,
  applyNichePlan,
  looksLikeContentPlanRequest,
  looksLikePlanRebuildConfirm,
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
export {
  connectLinkMessage,
  metaConnectStatusMessage,
  isMetaConnected,
  isMetaConnectPartial,
  isLinkedInConnected,
  isTikTokConnected,
  looksLikeAdsToggle,
  adsFeatureStatusLine,
  platformCapErrorSms,
} from "./smsConnect.js";
export {
  adsEnabled,
  brandFeatures,
  spendCaps,
  formatCents,
  setBrandFeatures,
  setSpendCaps,
  logAdApproval,
  assertCanSpend,
  weeklySpendCents,
  isAdsConnected as isAdsAccountConnected,
} from "./adsFeatures.js";
export { looksLikeAdLibraryRequest, adLibraryBrief } from "./adLibrary.js";
export { looksLikePastAdsRequest, pastAdsAnalysis } from "./pastAds.js";
export {
  looksLikeBoostRequest,
  proposeBoost,
  confirmBoost,
  cancelProposedBoost,
  getProposedBoost,
} from "./boost.js";
export {
  looksLikePaidCampaignRequest,
  looksLikeAdCampaignControl,
  proposeAdCampaign,
  confirmAdCampaign,
  getProposedAdCampaign,
  getLiveAdCampaign,
  pauseAdCampaign,
  resumeAdCampaign,
  killAdCampaign,
  proposeBudgetEdit,
  confirmBudgetEdit,
} from "./adCampaigns.js";
export {
  syncAdPerformance,
  paidDigestSection,
  looksLikeCapRaise,
  parseDollarCap,
} from "./adSpend.js";
export {
  isPersonalAccount,
  accountTypeOf,
  personalStrategySkipSms,
  personalAdsRefuseSms,
  personalIcpRefuseSms,
} from "./accountMode.js";
export {
  estimateCost,
  formatCostUsd,
  costEstimateSmsLine,
  weeklyAiSpendCapUsd,
} from "./costEstimate.js";
export type { CostKind } from "./costEstimate.js";
export {
  aiSpendWeekKey,
  currentWeeklyAiSpendUsd,
  assertAiSpendAllowed,
  recordAiSpend,
} from "./aiSpend.js";
export {
  ensureNicheExemplarBootstrap,
  seedOnboardingNicheExemplars,
} from "./designBootstrap.js";
export { gapInfo, lastInteractionAt, mostRecentActionable, isDaytime } from "./reengagement.js";
export type { GapInfo, GapBucket, Actionable, ActionableKind } from "./reengagement.js";
export { renderFeedMockup, renderStoryMockup, storeMockup, foldCaption, previewUrlForPost } from "./mockup.js";
export type { MockupInput } from "./mockup.js";
export {
  parseDestinationChoice,
  slicesForApproval,
  buildPlatformCaptions,
  fitCaption,
  fitLinkedInProfessional,
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

export {
  looksLikeKickoffRequest,
  inferKickoffFromUserMessage,
  inferKickoffFromKipCommit,
  enqueueKickoff,
  enqueueKickoffFromUserMessage,
  maybeEnqueueFromKipCommit,
  processKickoff,
  runKickoffDrain,
  reclaimStaleKickoffs,
  STALE_RUNNING_KICKOFF_MS,
} from "./kickoffs.js";
export type { KickoffEnqueueResult, KickoffDrainResult, KickoffDeliver, KickoffDrainOpts } from "./kickoffs.js";

export {
  maybeEnqueueCompetitorDraft,
  queueTrendDraftKickoffs,
  runAutonomyPass,
} from "./autonomy.js";

export type { AiVideoProvider, AiVideoRoute, QueueAiVideoResult } from "./aiVideo.js";

export {
  looksLikeUgcRequest,
  ugcDestinationFromBody,
  ugcConfigured,
  queueUgcJob,
  processUgcJob,
  queueUgcRetune,
  looksLikeUgcRetune,
  parseUgcRetune,
  describeUgcModelChains,
  falConfigured as ugcFalConfigured,
  STILL_MODELS as UGC_STILL_MODELS,
  MOTION_MODELS as UGC_MOTION_MODELS,
  resolveStillChain,
  resolveMotionChain,
  PRESETS_V1 as UGC_PRESETS_V1,
} from "./ugc/index.js";
export type { UgcDestination, UgcRetuneHint, QueueUgcResult } from "./ugc/index.js";
export type { DraftCaptionOpts } from "./draftCaption.js";

export {
  CONTENT_JOBS,
  DEFAULT_JOB_MIX,
  inferContentJob,
  formatBiasForJob,
  jobMixPromptBlock,
  pickUnderrepresentedJob,
  isContentJob,
} from "./contentJobs.js";
export type { ContentJob } from "./contentJobs.js";
export {
  listHookFormulas,
  pickHookFormulas,
  scoreHookLine,
  isBannedHookOpener,
  hooksPromptBlock,
} from "./hooks.js";
export type { HookFormula } from "./hooks.js";
export {
  FEED_FOLD_CHARS,
  MAX_HASHTAGS,
  captionJobForFormat,
  stripInvisibleChars,
  replaceSlopPhrases,
  limitHashtags,
  feedFoldPreview,
  captionJobPrompt,
  humanizeCaption,
} from "./humanizeCaption.js";
export type { CaptionJob } from "./humanizeCaption.js";
export { qualitySignalsLine } from "./insights.js";
