import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeApproval } from "../classify.js";
import { generalAgentEligible } from "../runGeneralAgent.js";
import { setupYieldsToWork } from "../setupYield.js";
import { clockFallbackSms, CLOCK_WAKE_PREFIX } from "../clockTurn.js";
import { KIP_AGENT_TOOLS } from "../agentTools.js";

function src(rel: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), "utf8");
}

function orchestratorSrcFiles(): string[] {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) {
        if (name.name === "__tests__" || name.name === "data") continue;
        walk(p);
      } else if (name.name.endsWith(".ts")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("Phases C–G one inbound brain", () => {
  it("C: photos are eligible and mediaIds reach the agent; no new 1/2/3 or carousel-or-separate trap", () => {
    expect(
      generalAgentEligible({
        hasMedia: true,
        hasPending: false,
        ownerMessage: "",
      }),
    ).toBe(true);
    const inbound = src("../processInbound.ts");
    expect(inbound).toMatch(/mediaIds: newMedia\.map/);
    expect(inbound).not.toMatch(/parkCarouselChoice/);
    expect(inbound).not.toMatch(/Want them as one swipeable carousel/);
    expect(inbound).not.toMatch(/Reply "carousel" or "separate"/);
    const mediaArm = inbound.slice(inbound.indexOf('case "media"'), inbound.indexOf('case "edit"'));
    expect(mediaArm).toMatch(/leftoverTurn/);
    expect(mediaArm).not.toMatch(/parkVariantPick/);
    expect(mediaArm).not.toMatch(/variantPickSms/);
    const refresh = src("../creativeRefresh.ts");
    expect(refresh).not.toMatch(/variantPickSms/);
    expect(refresh).not.toMatch(/parkVariantPick/);
    expect(refresh).toMatch(/Nothing posts until you say yes/);
  });

  it("D: dest-link stands down on pending yes; plan yes does not enqueue first_batch", () => {
    expect(looksLikeApproval("yes")).toBe(true);
    const inbound = src("../processInbound.ts");
    expect(inbound).toMatch(/!\(pending && looksLikeApproval\(message\.body\)\)/);
    expect(inbound).not.toMatch(/enqueueKickoff\(brand, "first_batch"/);
    expect(inbound).not.toMatch(/applyNichePlan\(brand, proposedPlan\)/);
    expect(inbound).not.toMatch(/confirmPerfSuggestion\(brand\)/);
    expect(inbound).not.toMatch(/activateCampaign\(brand, proposed/);
    expect(inbound).toMatch(/confirmBoost/);
    expect(inbound).toMatch(/confirmAdCampaign/);
    expect(inbound).toMatch(/confirmBudgetEdit/);
    const approvalArm = inbound.slice(inbound.indexOf('case "approval"'), inbound.indexOf('case "question"'));
    expect(approvalArm).toMatch(/approveSelectedDestinations/);
    expect(approvalArm).not.toMatch(/leftoverTurn|runGeneralAgent/);
    expect(KIP_AGENT_TOOLS.map((t) => t.name)).toContain("confirm_pending_ask");
  });

  it("E: onboarding yields a photo or draft ask; one-question rewriter is gone", () => {
    expect(setupYieldsToWork("", 1)).toBe(true);
    expect(setupYieldsToWork("just draft something", 0)).toBe(true);
    expect(setupYieldsToWork("hi", 0)).toBe(false);
    const inbound = src("../processInbound.ts");
    expect(inbound).toMatch(/setupYieldsToWork/);
    expect(inbound).not.toMatch(/Got it — finishing your voice first/);
    const onboarding = src("../onboarding.ts");
    expect(onboarding).not.toMatch(/enforceOneQuestion/);
  });

  it("F: worker clocks compose via the brain and keep quiet hours", () => {
    expect(CLOCK_WAKE_PREFIX).toMatch(/Clock wake/);
    expect(clockFallbackSms("pending draft sitting")).not.toMatch(/Reply yes/i);
    const checkin = src("../../../../apps/worker/src/triggers/checkin.ts");
    expect(checkin).toMatch(/composeClockSms|composeSms/);
    expect(checkin).not.toMatch(/Anything to send me this week\?/);
    const chase = src("../../../../apps/worker/src/proactive/chase.ts");
    expect(chase).toMatch(/composeClockSms/);
    expect(chase).not.toMatch(/Reply yes to send it/);
    const gap = src("../../../../apps/worker/src/proactive/gapFill.ts");
    expect(gap).toMatch(/composeClockSms/);
    expect(gap).toMatch(/isDaytime/);
    expect(gap).not.toMatch(/no to bin it/);
    const reminder = src("../../../../apps/worker/src/triggers/reminder.ts");
    expect(reminder).toMatch(/composeClockSms|composeSms/);
    expect(reminder).toMatch(/isDaytime/);
  });

  it("G: three-brain flags are gone from orchestrator src; agent is default; yes still a gate", () => {
    expect(
      generalAgentEligible({
        flag: false,
        hasMedia: false,
        hasPending: false,
        ownerMessage: "hey",
      }),
    ).toBe(true);
    expect(
      generalAgentEligible({
        hasPending: true,
        ownerMessage: "yes",
      }),
    ).toBe(false);
    for (const file of orchestratorSrcFiles()) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/KIP_GENERAL_AGENT/);
      expect(text).not.toMatch(/KIP_TOOL_LOOP/);
      expect(text).not.toMatch(/KIP_SMART_PLANNER/);
    }
  });
});
