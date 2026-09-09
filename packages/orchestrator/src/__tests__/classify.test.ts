import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../llm.js", () => ({
  callLLM: vi.fn(async () => JSON.stringify({ classification: "instruction", confidence: 0.9 })),
}));

import { callLLM } from "../llm.js";
import { ruleBasedClassify, classifyInbound } from "../classify.js";

const mockedCallLLM = callLLM as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedCallLLM.mockClear();
  mockedCallLLM.mockImplementation(async () =>
    JSON.stringify({ classification: "instruction", confidence: 0.9 }),
  );
});

describe("ruleBasedClassify", () => {
  it("classifies any message with media as 'media', regardless of text", () => {
    expect(ruleBasedClassify("check this out", true, false)?.classification).toBe("media");
    expect(ruleBasedClassify(null, true, false)?.classification).toBe("media");
  });

  it("classifies plain approval words as 'approval'", () => {
    expect(ruleBasedClassify("yes", false, true)?.classification).toBe("approval");
    expect(ruleBasedClassify("Yep!", false, true)?.classification).toBe("approval");
    expect(ruleBasedClassify("ok", false, true)?.classification).toBe("approval");
    expect(ruleBasedClassify("👍", false, true)?.classification).toBe("approval");
    expect(ruleBasedClassify("looks good", false, true)?.classification).toBe("approval");
  });

  it("does not treat a channel pick as an approval", () => {
    expect(ruleBasedClassify("X only", false, true)?.classification).not.toBe("approval");
    expect(ruleBasedClassify("Threads only", false, true)?.classification).not.toBe("approval");
    expect(ruleBasedClassify("X and Threads", false, true)?.classification).not.toBe("approval");
  });

  it("classifies question-shaped text as 'question'", () => {
    expect(ruleBasedClassify("What time will this post?", false, false)?.classification).toBe(
      "question",
    );
    expect(ruleBasedClassify("Can you tell me the schedule", false, false)?.classification).toBe(
      "question",
    );
  });

  it("classifies edit-signal text as 'edit' only when a pending post exists", () => {
    expect(ruleBasedClassify("can you make it shorter", false, true)?.classification).toBe("edit");
    // No pending post to edit — should NOT claim 'edit'; falls through to null (ambiguous).
    expect(ruleBasedClassify("can you make it shorter", false, false)).toBeNull();
  });

  it("treats an empty body as low-confidence 'other'", () => {
    const r = ruleBasedClassify("", false, false);
    expect(r?.classification).toBe("other");
    expect(r!.confidence).toBeLessThan(0.5);
  });

  it("returns null (ambiguous, defers to LLM) for text with no clear signal", () => {
    expect(ruleBasedClassify("thanks so much for everything", false, false)).toBeNull();
  });
});

describe("classifyInbound", () => {
  it("uses the rule-based result and never calls the LLM when unambiguous", async () => {
    const result = await classifyInbound({ body: "yes", hasMedia: false, hasPendingPost: true });
    expect(result.classification).toBe("approval");
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("falls back to the LLM for ambiguous text and returns its classification", async () => {
    const result = await classifyInbound({
      body: "thanks so much for everything",
      hasMedia: false,
      hasPendingPost: false,
    });
    expect(mockedCallLLM).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe("instruction");
    expect(result.confidence).toBe(0.9);
  });

  it("falls back to low-confidence 'other' when the LLM returns malformed JSON", async () => {
    mockedCallLLM.mockResolvedValueOnce("not json at all");
    const result = await classifyInbound({
      body: "hmm not sure what this is",
      hasMedia: false,
      hasPendingPost: false,
    });
    expect(result.classification).toBe("other");
    expect(result.confidence).toBe(0);
  });

  it("falls back to low-confidence 'other' when the LLM call throws", async () => {
    mockedCallLLM.mockRejectedValueOnce(new Error("network error"));
    const result = await classifyInbound({
      body: "hmm not sure what this is",
      hasMedia: false,
      hasPendingPost: false,
    });
    expect(result.classification).toBe("other");
    expect(result.confidence).toBe(0);
  });
});
