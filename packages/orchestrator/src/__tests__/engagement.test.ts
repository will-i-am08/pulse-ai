import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM so we control the model's "decision", and the DB so handleInteraction
// can run without a connection.
vi.mock("../llm.js", () => ({ callLLM: vi.fn() }));
vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return { ...actual, query: vi.fn(async () => []), queryOne: vi.fn(async () => null) };
});

import { callLLM } from "../llm.js";
import { handleInteraction } from "../engagement.js";
import type { Brand, Interaction } from "@pulse/shared";

const mockedCallLLM = callLLM as unknown as ReturnType<typeof vi.fn>;

const brand = { id: "b1", name: "Test Co", facts: {} } as unknown as Brand;
const interaction = (kind: string, text: string): Interaction =>
  ({ id: "i1", brand_id: "b1", platform: "instagram", kind, external_id: null, author: "@x", text, sentiment: null, bucket: null, status: "new", created_at: "" }) as unknown as Interaction;

function decide(d: Record<string, unknown>) {
  mockedCallLLM.mockResolvedValue(JSON.stringify(d));
}

beforeEach(() => mockedCallLLM.mockReset());

describe("engagement safety rails", () => {
  it("never auto-replies to a negative interaction — even if the model says 'auto'", async () => {
    decide({ bucket: "support", sentiment: "negative", action: "auto", reply: "no worries!" });
    const res = await handleInteraction(brand, interaction("comment", "worst service ever"));
    expect(res.publicReply).toBeUndefined(); // must not post publicly
    expect(res.ownerMessage).toBeDefined(); // escalated to the owner instead
  });

  it("always hides spam and never bothers the owner — even if the model says 'auto'", async () => {
    decide({ bucket: "spam", sentiment: "neutral", action: "auto", reply: "sure!" });
    const res = await handleInteraction(brand, interaction("comment", "click bit.ly/win now"));
    expect(res.publicReply).toBeUndefined();
    expect(res.ownerMessage).toBeUndefined();
  });

  it("auto-replies to a genuinely positive, safe interaction", async () => {
    decide({ bucket: "general", sentiment: "positive", action: "auto", reply: "thanks so much!" });
    const res = await handleInteraction(brand, interaction("comment", "love this!"));
    expect(res.publicReply).toBe("thanks so much!");
  });

  it("qualifies a lead and hands it off (public reply + owner message)", async () => {
    decide({ bucket: "lead", sentiment: "positive", action: "escalate", reply: "here's our booking link", summary: "wants to book" });
    const res = await handleInteraction(brand, interaction("dm", "can I book for Saturday?"));
    expect(res.publicReply).toBe("here's our booking link");
    expect(res.ownerMessage).toContain("Lead");
  });
});
