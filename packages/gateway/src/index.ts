export {
  handleInbound,
  resolveBrand,
  resolveBrandByPhone,
  resolveBrandByDiscord,
  resolveBrandByLinq,
  captureMedia,
  sendToBrand,
  activeChannel,
  setActiveChannel,
} from "./gateway.js";
export { createLinqChannel, LinqChannel } from "./linq-channel.js";
// Re-exported from orchestrator so the worker (which depends on gateway, not
// orchestrator directly) can reach the re-engagement helpers.
export { mostRecentActionable, isDaytime } from "@pulse/orchestrator";
export type { Actionable } from "@pulse/orchestrator";
// Re-exported for the worker engagement loop: claim + triage inbound
// interactions. The worker must claim a row before triaging it.
export { createInteraction, claimInteraction, handleInteraction } from "@pulse/orchestrator";
export type { EngagementResult } from "@pulse/orchestrator";
export { withBackoff } from "./backoff.js";
export type { BackoffOptions } from "./backoff.js";
