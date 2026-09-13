import { describe, expect, it } from "vitest";
import { looksLikeSkipConnect, looksLikeUnsureReply } from "../onboarding.js";

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
