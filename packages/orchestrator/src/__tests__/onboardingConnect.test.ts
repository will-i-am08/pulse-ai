import { describe, expect, it } from "vitest";
import { looksLikeSkipConnect } from "../onboarding.js";

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
