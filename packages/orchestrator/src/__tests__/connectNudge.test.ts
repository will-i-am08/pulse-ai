import { describe, expect, it, vi } from "vitest";
import { looksLikeSkipConnect } from "../onboarding.js";

vi.mock("../smsConnect.js", () => ({
  isMetaConnected: () => false,
  connectLinkMessage: () => "One tap to connect Instagram + Facebook:\nhttps://app.example/c/test-token",
}));

describe("looksLikeSkipConnect", () => {
  it("accepts skip / later / don't have", () => {
    expect(looksLikeSkipConnect("skip")).toBe(true);
    expect(looksLikeSkipConnect("later")).toBe(true);
    expect(looksLikeSkipConnect("don't have instagram")).toBe(true);
    expect(looksLikeSkipConnect("we run a cafe")).toBe(false);
  });
});

describe("connectNudgeMessage", () => {
  it("asks to connect and includes the mocked deep link", async () => {
    const { connectNudgeMessage } = await import("../connectNudge.js");
    const msg = connectNudgeMessage(
      {
        id: "00000000-0000-0000-0000-000000000001",
        name: "Test Cafe",
        onboarding_state: { status: "done", answers: { skipped_connect: "1" } },
      } as never,
      0,
    );
    expect(msg.toLowerCase()).toMatch(/instagram/);
    expect(msg).toContain("https://app.example/c/test-token");
  });

  it("changes copy after prior nudges", async () => {
    const { connectNudgeMessage } = await import("../connectNudge.js");
    const brand = {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Test Cafe",
      onboarding_state: { status: "done", answers: { skipped_connect: "1" } },
    } as never;
    expect(connectNudgeMessage(brand, 2)).not.toEqual(connectNudgeMessage(brand, 0));
  });
});
