import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeApproval } from "../classify.js";
import { looksLikeKickoffRequest } from "../kickoffs.js";
import { generalAgentEligible } from "../runGeneralAgent.js";

function processInboundSrc(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../processInbound.ts"), "utf8");
}

describe("Phase B kickoffs through the brain", () => {
  it("does not own creative asks with looksLikeKickoffRequest before the agent", () => {
    const src = processInboundSrc();
    expect(src).not.toMatch(/trySmartPlannerKickoff/);
    expect(src).not.toMatch(/KIP_SMART_PLANNER/);
    expect(src).not.toMatch(/KIP_TOOL_LOOP/);
    expect(src).not.toMatch(/answerWithTools/);
    const overlayIdx = src.indexOf('"Remove the text" / strip overlay on the pending draft');
    const agentIdx = src.indexOf("General agent (flagged, off by default)");
    expect(overlayIdx).toBeGreaterThan(-1);
    expect(agentIdx).toBeGreaterThan(overlayIdx);
    const between = src.slice(overlayIdx, agentIdx);
    expect(between).not.toMatch(/looksLikeKickoffRequest/);
    expect(between).not.toMatch(/enqueueKickoffFromUserMessage/);
  });

  it("kickoff-shaped SMS is eligible when the agent is on", () => {
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: false,
        ownerMessage: "Draft me a post about the new bun",
      }),
    ).toBe(true);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: false,
        ownerMessage: "Draft something in my lane",
      }),
    ).toBe(true);
    expect(looksLikeKickoffRequest("Draft me a post about the new bun")).toBe(true);
    expect(looksLikeKickoffRequest("how often should I post?")).toBe(false);
  });

  it("cadence questions are not kickoffs and yes on a draft still bypasses the agent", () => {
    expect(looksLikeKickoffRequest("How often should I post?")).toBe(false);
    expect(looksLikeApproval("yes")).toBe(true);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: true,
        ownerMessage: "yes",
      }),
    ).toBe(false);
    const src = processInboundSrc();
    const approvalArm = src.slice(src.indexOf('case "approval"'), src.indexOf('case "question"'));
    expect(approvalArm).toMatch(/approveSelectedDestinations/);
    expect(approvalArm).not.toMatch(/leftoverTurn|runGeneralAgent/);
  });
});
