export {
  handleInbound,
  resolveBrand,
  resolveBrandByPhone,
  resolveBrandByLinq,
  captureMedia,
  sendToBrand,
  sendToOperator,
  activeChannel,
  setActiveChannel,
  startTypingKeeper,
  splitIntoBubbles,
  shouldSendInstantTextAck,
  shouldSendSlowWorkFiller,
  shouldSkipInboundBurst,
  outboundTypingPauseMs,
  looksLikeProgressCheck,
  refersToAttachedMedia,
  mediaIdsFromPublicUrls,
} from "./gateway.js";
export type { TypingKeeper, HandleInboundOpts } from "./gateway.js";
export { createLinqChannel, LinqChannel } from "./linq-channel.js";
export { deliverPendingLoginCodes } from "./loginCodes.js";
// Re-exported from orchestrator so the worker (which depends on gateway, not
// orchestrator directly) can reach the re-engagement helpers.
export { mostRecentActionable, isDaytime } from "@pulse/orchestrator";
export type { Actionable } from "@pulse/orchestrator";
// Re-exported for the worker engagement loop: claim + triage inbound
// interactions. The worker must claim a row before triaging it.
export { createInteraction, claimInteraction, handleInteraction, maybeAutoPushLead } from "@pulse/orchestrator";
export type { EngagementResult } from "@pulse/orchestrator";
export { withBackoff } from "./backoff.js";
export type { BackoffOptions } from "./backoff.js";
export { handleUnknownInbound } from "./smsLead.js";
export type { UnknownInboundResult } from "./smsLead.js";
