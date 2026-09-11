import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the LLM so we control the model's "decision", and the DB so handleInteraction
// can run without a connection.
vi.mock("../llm.js", () => ({ callLLM: vi.fn() }));
vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return { ...actual, query: vi.fn(async () => []), queryOne: vi.fn(async () => null) };
});
vi.mock("@pulse/graph", () => ({
  getGraphAdapter: vi.fn(() => ({
    reply: vi.fn(async () => ({ externalReplyId: "ext-1" })),
  })),
}));

import { callLLM } from "../llm.js";
import { query, queryOne } from "@pulse/shared";
import { getGraphAdapter } from "@pulse/graph";
import {
  handleInteraction,
  sendLatestDraft,
  editLatestDraft,
  latestDraftedInteraction,
} from "../engagement.js";
import type { Brand, Interaction } from "@pulse/shared";

const mockedCallLLM = callLLM as unknown as ReturnType<typeof vi.fn>;
const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockedGetGraph = getGraphAdapter as unknown as ReturnType<typeof vi.fn>;

const brand = { id: "b1", name: "Test Co", facts: {} } as unknown as Brand;
const interaction = (kind: string, text: string): Interaction =>
  ({ id: "i1", brand_id: "b1", platform: "instagram", kind, external_id: null, author: "@x", text, sentiment: null, bucket: null, status: "new", created_at: "" }) as unknown as Interaction;

function decide(d: Record<string, unknown>) {
  mockedCallLLM.mockResolvedValue(JSON.stringify(d));
}

beforeEach(() => {
  mockedCallLLM.mockReset();
  mockedQuery.mockReset();
  mockedQuery.mockResolvedValue([]);
  mockedQueryOne.mockReset();
  mockedQueryOne.mockResolvedValue(null);
  mockedGetGraph.mockClear();
  mockedGetGraph.mockReturnValue({
    reply: vi.fn(async () => ({ externalReplyId: "ext-1" })),
  });
});

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
    expect(res.ownerMessage).toContain("Lead card");
  });
});

/** Thin A6 — SMS approve/edit of drafted engagement replies (must keep working). */
describe("A6 SMS draft approve/edit", () => {
  it("sendLatestDraft posts via graph.reply and marks the interaction sent", async () => {
    const draft = {
      id: "i-draft",
      brand_id: "b1",
      platform: "instagram",
      kind: "comment",
      status: "drafted",
      text: "hours?",
    };
    const replyRow = { id: "r1", body: "We're open 9-5!" };
    mockedQueryOne
      .mockResolvedValueOnce(draft) // latestDraftedInteraction
      .mockResolvedValueOnce(replyRow); // interaction_replies body
    mockedQuery.mockResolvedValue([]);

    const sent = await sendLatestDraft(brand);
    expect(sent).toBe("We're open 9-5!");
    expect(mockedGetGraph).toHaveBeenCalled();
    const graph = mockedGetGraph.mock.results.at(-1)?.value as { reply: ReturnType<typeof vi.fn> };
    expect(graph.reply).toHaveBeenCalled();
    expect(
      mockedQuery.mock.calls.some(
        (c) => String(c[0]).includes("interaction_replies") && String(c[0]).includes("sent"),
      ),
    ).toBe(true);
    expect(
      mockedQuery.mock.calls.some(
        (c) => String(c[0]).includes("update interactions set status") && Array.isArray(c[1]) && c[1][0] === "auto_replied",
      ),
    ).toBe(true);
  });

  it("sendLatestDraft returns null when there is no drafted interaction", async () => {
    mockedQueryOne.mockResolvedValueOnce(null);
    expect(await sendLatestDraft(brand)).toBeNull();
  });

  it("editLatestDraft revises the draft body and keeps status drafted", async () => {
    const draft = { id: "i-draft", brand_id: "b1", status: "drafted" };
    const current = { id: "r1", body: "Long reply about everything under the sun." };
    mockedQueryOne
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce(current);
    mockedCallLLM.mockResolvedValue("Short reply.");
    mockedQuery.mockResolvedValue([]);

    const revised = await editLatestDraft(brand, "make it shorter");
    expect(revised).toBe("Short reply.");
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("update interaction_replies set body"),
      ["Short reply.", "r1"],
    );
  });

  it("latestDraftedInteraction queries drafted status only", async () => {
    mockedQueryOne.mockResolvedValueOnce({ id: "i1", status: "drafted" });
    const row = await latestDraftedInteraction("b1");
    expect(row?.id).toBe("i1");
    expect(String(mockedQueryOne.mock.calls[0]![0])).toContain("status = 'drafted'");
  });
});
