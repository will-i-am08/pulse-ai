import { describe, expect, it } from "vitest";
import {
  craftHumanAck,
  acknowledgeThenContinue,
  replyAlreadyAcked,
  stripLeadingAck,
} from "../onboarding.js";
import type { Brand } from "@pulse/shared";

function brandWithName(name: string | null): Brand {
  return {
    id: "b1",
    name: "Test",
    facts: name ? { owner_name: name } : {},
  } as Brand;
}

describe("craftHumanAck", () => {
  it("skips filler wrapping acks for status checks", () => {
    expect(craftHumanAck(brandWithName("Bill"), "Are you done?")).toBe("");
    expect(craftHumanAck(brandWithName("Bill"), "How's it going?")).toBe("");
  });

  it("acks hey with a greeting", () => {
    expect(craftHumanAck(brandWithName("Bill"), "hey")).toBe("Hey Bill!");
  });

  it("acks Done warmly", () => {
    expect(craftHumanAck(brandWithName("Bill"), "Done").toLowerCase()).toMatch(/nice one/);
  });

  it("acks uncertainty warmly instead of a robotic got-it", () => {
    const ack = craftHumanAck(brandWithName("Bill"), "I'm not sure");
    expect(ack.toLowerCase()).toMatch(/all good/);
    expect(ack).toMatch(/Bill/);
  });

  it("acks a real answer like a person who listened", () => {
    const ack = craftHumanAck(
      brandWithName("Bill"),
      "We help busy cafe owners fill their weekday mornings with locals",
    );
    expect(ack.toLowerCase()).toMatch(/makes sense/);
  });

  it("falls back without a name on short vibes", () => {
    expect(craftHumanAck(brandWithName(null), "cool")).toMatch(/cool/i);
  });
});

describe("acknowledgeThenContinue", () => {
  it("goes straight to the next beat on status checks (no wrapping filler)", () => {
    const out = acknowledgeThenContinue(
      brandWithName("Bill"),
      "Are you done?",
      "Hey Bill — what's your niche?",
    );
    expect(out).toBe("Hey Bill — what's your niche?");
  });

  it("puts a real ack before the next beat", () => {
    const out = acknowledgeThenContinue(
      brandWithName("Bill"),
      "We help busy cafe owners fill weekday mornings",
      "What's your niche?",
    );
    expect(out).toMatch(/^Makes sense/i);
    expect(out).toContain("\n\nWhat's your niche?");
  });

  it("does not double-ack when next already opens with one", () => {
    const out = acknowledgeThenContinue(
      brandWithName("Bill"),
      "hey",
      "Hey Bill!\n\nWhat's your niche?",
    );
    expect(out).toBe("Hey Bill!\n\nWhat's your niche?");
  });
});

describe("stripLeadingAck", () => {
  it("strips a leading ack bubble", () => {
    expect(stripLeadingAck("Got you, Bill.\n\nWhat's your niche?")).toBe("What's your niche?");
  });

  it("returns empty when the reply was only an ack", () => {
    expect(stripLeadingAck("Makes sense, Bill.")).toBe("");
  });

  it("leaves non-ack replies alone", () => {
    expect(stripLeadingAck("What's your niche?")).toBe("What's your niche?");
  });

  it("does not wipe a single-paragraph work commitment after an instant ack", () => {
    const commitment =
      "Yeah sure — I'll redo all 4 with photo backgrounds. Give me about 4 minutes and I'll text them over.";
    expect(stripLeadingAck(commitment)).toBe(commitment);
    expect(
      stripLeadingAck(
        "On it — regenerating 4 with real photo backgrounds (not text cards). I'll text them over for approval.",
      ),
    ).toMatch(/regenerating 4/);
  });
});

describe("replyAlreadyAcked", () => {
  it("detects human-SMM ack openers", () => {
    expect(replyAlreadyAcked("Makes sense, Bill.\n\nNext question")).toBe(true);
    expect(replyAlreadyAcked("What's your niche?")).toBe(false);
  });

  it("does not treat substantive on-it work commitments as thin acks", () => {
    expect(replyAlreadyAcked("On it.")).toBe(true);
    expect(replyAlreadyAcked("Got you, Bill.")).toBe(true);
    expect(
      replyAlreadyAcked(
        "On it — regenerating 4 with real photo backgrounds (not text cards). I'll text them over for approval.",
      ),
    ).toBe(false);
  });
});
