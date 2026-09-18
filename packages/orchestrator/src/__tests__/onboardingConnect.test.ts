import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeSkipConnect, looksLikeUnsureReply, looksLikeReadyToWrap, voiceRecapSms } from "../onboarding.js";

describe("looksLikeSkipConnect", () => {
  it("accepts common skip phrases", () => {
    expect(looksLikeSkipConnect("skip")).toBe(true);
    expect(looksLikeSkipConnect("Skip for now")).toBe(true);
    expect(looksLikeSkipConnect("later")).toBe(true);
    expect(looksLikeSkipConnect("don't have instagram")).toBe(true);
    expect(looksLikeSkipConnect("no ig")).toBe(true);
  });

  it("rejects normal answers", () => {
    expect(looksLikeSkipConnect("we run a cafe in Fitzroy")).toBe(false);
    expect(looksLikeSkipConnect("connect")).toBe(false);
  });
});

describe("looksLikeUnsureReply", () => {
  it("matches idk / not sure variants", () => {
    expect(looksLikeUnsureReply("idk")).toBe(true);
    expect(looksLikeUnsureReply("I'm not sure")).toBe(true);
    expect(looksLikeUnsureReply("not sure")).toBe(true);
    expect(looksLikeUnsureReply("can't think of any")).toBe(true);
    expect(looksLikeUnsureReply("no idea")).toBe(true);
  });

  it("rejects real answers", () => {
    expect(looksLikeUnsureReply("entrepreneurial tips and quotes")).toBe(false);
    expect(looksLikeUnsureReply("faceless stock photos")).toBe(false);
  });
});

describe("looksLikeReadyToWrap", () => {
  it("matches a clear we're-good", () => {
    expect(looksLikeReadyToWrap("yeah that sounds right")).toBe(true);
    expect(looksLikeReadyToWrap("that's enough, wrap it")).toBe(true);
    expect(looksLikeReadyToWrap("sound right")).toBe(true);
  });

  it("does not wrap a real answer or a bare yeah", () => {
    expect(looksLikeReadyToWrap("yeah")).toBe(false);
    expect(looksLikeReadyToWrap("Homeowners around Brunswick")).toBe(false);
  });
});

describe("lab chat restart", () => {
  it("clears the previous owner name, kip memory, and voice before the new greeting", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../onboarding.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function archiveLabChatAndRestart"));
    expect(fn).toMatch(/delete facts\.owner_name/);
    expect(fn).toMatch(/delete facts\.look_pack/);
    expect(fn).toMatch(/delete facts\.differentiators/);
    expect(fn).toMatch(/delete facts\.kip_preferences/);
    expect(fn).toMatch(/delete facts\.kip_decisions/);
    expect(fn).toMatch(/delete facts\.open_loops/);
    expect(fn).toMatch(/delete from design_memory/);
    expect(fn).toMatch(/delete from strategy_notes/);
    expect(fn).toMatch(/delete from pillars/);
    expect(fn).toMatch(/visual = '\{\}'::jsonb/);
    expect(fn).toMatch(/emptyBrandVoiceProfile/);
    expect(fn).toMatch(/'pending_approval', 'draft', 'approved', 'scheduled'/);
    expect(fn).toMatch(/content_plans/);
    expect(fn).toMatch(/'pending', 'proposed', 'accepted'/);
    expect(fn.indexOf("delete facts.owner_name")).toBeLessThan(fn.indexOf("restartOnboarding"));
  });

  it("keeps onboarding done on New chat — no contact-card re-arm", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../onboarding.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function archiveLabChatAndRestart"));
    expect(fn).toMatch(/wasDone/);
    expect(fn).toMatch(/Fresh chat for/);
    expect(fn).toMatch(/same setup, clean thread/);
    // Contact welcome only via restartOnboarding for incomplete setups.
    expect(fn.indexOf("wasDone")).toBeLessThan(fn.indexOf("restartOnboarding"));
  });

  it("wraps on yeah-that-sounds-right without another discovery question", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../onboarding.ts"),
      "utf8",
    );
    expect(src).toMatch(/looksLikeReadyToWrap/);
    expect(src).toMatch(/turns >= 3 && looksLikeReadyToWrap/);
  });

  it("tells the interviewer this is a brand-new chat with no prior memory", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../onboarding.ts"),
      "utf8",
    );
    expect(src).toMatch(/Brand-new conversation/);
    expect(src).toMatch(/zero memory of any previous lab chat/);
    expect(src).not.toMatch(/The account name on file is a placeholder/);
    expect(src).toMatch(/alreadyAskedStaffing/);
    expect(src).toMatch(/alreadyAskedNeverDos/);
    expect(src).toMatch(/unsureCount >= 2 \|\| turns >= 4/);
    expect(src).toMatch(/Never-do and admired accounts are nice-to-haves/);
  });
});

describe("wrap hold", () => {
  it("does not pile a plan tease on a draft ask during wrap", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../processInbound.ts"),
      "utf8",
    );
    expect(src).toMatch(/finishing your voice first, then I'll draft that/);
  });
});

describe("onboarding rundown SMS", () => {
  it("is main-only — finishOnboarding does not concatenate an afterthought", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../onboarding.ts"),
      "utf8",
    );
    expect(src).toMatch(/export type OnboardingRundown = \{\s*main: string;\s*\}/);
    const finish = src.slice(
      src.indexOf("export async function finishOnboarding"),
      src.indexOf("async function compileProfile"),
    );
    expect(finish).toMatch(/return \{\s*main:/);
    expect(finish).not.toMatch(/afterthought/);
    expect(src).not.toMatch(/I'll text you in about/);
    expect(src).toMatch(/\$\{step\.reply\}\\n\\n\$\{rundown\.main\}/);
    expect(src).not.toMatch(/rundown\.afterthought/);
  });
});

describe("voiceRecapSms", () => {
  it("does not say I'll skip use-jokes or send them to a dashboard", () => {
    const sms = voiceRecapSms(["warm", "direct"], ["use jokes in captions", "Don't sell hard"]);
    expect(sms).toMatch(/warm, direct/);
    expect(sms).toMatch(/I'll stay clear of jokes in captions/i);
    expect(sms).toMatch(/I won't sell hard/i);
    expect(sms).not.toMatch(/I'll skip use /i);
    expect(sms).not.toMatch(/I'll stay clear of .+ and /i);
    expect(sms).not.toMatch(/dashboard/i);
  });
});
