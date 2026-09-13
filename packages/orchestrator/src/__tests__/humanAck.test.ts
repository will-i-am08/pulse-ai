import { describe, expect, it } from "vitest";
import { craftHumanAck, acknowledgeThenContinue } from "../onboarding.js";
import type { Brand } from "@pulse/shared";

function brandWithName(name: string | null): Brand {
  return {
    id: "b1",
    name: "Test",
    facts: name ? { owner_name: name } : {},
  } as Brand;
}

describe("craftHumanAck", () => {
  it("acks 'Are you done?' with On it + name", () => {
    const ack = craftHumanAck(brandWithName("Bill"), "Are you done?");
    expect(ack.toLowerCase()).toMatch(/on it/);
    expect(ack).toMatch(/Bill/);
  });

  it("acks hey with a greeting", () => {
    expect(craftHumanAck(brandWithName("Bill"), "hey")).toBe("Hey Bill!");
  });

  it("acks Done warmly", () => {
    expect(craftHumanAck(brandWithName("Bill"), "Done").toLowerCase()).toMatch(/nice one/);
  });

  it("falls back without a name", () => {
    expect(craftHumanAck(brandWithName(null), "Are you done?").toLowerCase()).toMatch(/^on it/);
  });
});

describe("acknowledgeThenContinue", () => {
  it("puts ack before the next beat", () => {
    const out = acknowledgeThenContinue(
      brandWithName("Bill"),
      "Are you done?",
      "Hey Bill — what's your niche?",
    );
    expect(out).toMatch(/^On it, Bill/);
    expect(out).toContain("\n\nHey Bill — what's your niche?");
  });
});
