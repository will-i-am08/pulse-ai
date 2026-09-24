import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeApproval } from "../classify.js";
import { generalAgentEligible } from "../runGeneralAgent.js";

function processInboundSrc(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../processInbound.ts"), "utf8");
}

describe("Phase A leftover turns", () => {
  it("does not steal greetings, calendar, ideas, digest, or brand-recall before the brain", () => {
    const src = processInboundSrc();
    expect(src).toMatch(/async function leftoverTurn/);
    expect(src).not.toMatch(/looksLikeDigestRequest\(message\.body\)/);
    expect(src).not.toMatch(/looksLikeCalendarAsk\(message\.body\)/);
    expect(src).not.toMatch(/looksLikeIdeasAsk\(message\.body\)/);
    expect(src).not.toMatch(/looksLikeBrandRecallAsk\(message\.body\)/);
    expect(src).not.toMatch(/loadCalendarSms|loadIdeasSms|loadBrandRecallSms|buildPerformanceDigest\(/);
    expect(src).not.toMatch(/quickSocialReply|quickReengageReply/);
    const greeting = src.slice(
      src.indexOf("looksLikeGreeting(message.body) || looksLikeAffirmation"),
      src.indexOf("looksLikeGreeting(message.body) || looksLikeAffirmation") + 900,
    );
    expect(greeting).toMatch(/leftoverTurn\(/);
  });

  it("pending draft + hey is leftover, never an approval", () => {
    expect(looksLikeApproval("hey")).toBe(false);
    expect(looksLikeApproval("hi")).toBe(false);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: true,
        ownerMessage: "hey",
      }),
    ).toBe(true);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: true,
        ownerMessage: "yes",
      }),
    ).toBe(false);
  });

  it("fuzzy edit does not get the yes/change/no command menu", () => {
    const src = processInboundSrc();
    expect(src).not.toMatch(/Not quite sure what you'd like there/);
    expect(src).not.toMatch(/Reply "yes" to approve, tell me what to change, or "no" to discard/);
    expect(src).not.toMatch(/Tell me what to make — a post, a carousel/);
    expect(looksLikeApproval("idk maybe warmer")).toBe(false);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: true,
        ownerMessage: "idk maybe warmer",
      }),
    ).toBe(true);
    const low = src.slice(src.indexOf("LOW_CONFIDENCE_THRESHOLD"), src.indexOf("Deep research verbs"));
    expect(low).toMatch(/leftoverTurn\(/);
    const fallback = src.slice(src.lastIndexOf("trySmartPlannerKickoff"));
    expect(fallback).toMatch(/leftoverTurn\(/);
  });

  it("yes on an offered draft still hits approveSelectedDestinations", () => {
    expect(looksLikeApproval("yes")).toBe(true);
    const src = processInboundSrc();
    const approvalArm = src.slice(src.indexOf('case "approval"'), src.indexOf('case "question"'));
    expect(approvalArm).toMatch(/approveSelectedDestinations/);
    expect(approvalArm).not.toMatch(/leftoverTurn|runGeneralAgent/);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: true,
        ownerMessage: "yes",
      }),
    ).toBe(false);
  });
});
