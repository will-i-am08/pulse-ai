import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeSkipConnect, looksLikeUnsureReply, voiceRecapSms } from "../onboarding.js";

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

describe("lab chat restart", () => {
  it("clears the previous owner name and voice profile before the new greeting", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../onboarding.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function archiveLabChatAndRestart"));
    expect(fn).toMatch(/delete facts\.owner_name/);
    expect(fn).toMatch(/delete facts\.look_pack/);
    expect(fn).toMatch(/delete facts\.differentiators/);
    expect(fn).toMatch(/visual = '\{\}'::jsonb/);
    expect(fn).toMatch(/emptyBrandVoiceProfile/);
    expect(fn).toMatch(/'pending_approval', 'draft', 'approved', 'scheduled'/);
    expect(fn).toMatch(/content_plans/);
    expect(fn.indexOf("delete facts.owner_name")).toBeLessThan(fn.indexOf("restartOnboarding"));
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
