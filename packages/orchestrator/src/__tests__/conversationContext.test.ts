import { describe, expect, it } from "vitest";
import { normalizeChatTurns, resolveConversationContextArgs } from "../conversationContext.js";

describe("normalizeChatTurns", () => {
  it("drops a leading assistant turn and merges same-role messages", () => {
    const out = normalizeChatTurns([
      { role: "assistant", content: "Hey." },
      { role: "user", content: "I prefer carousels" },
      { role: "user", content: "no stories" },
      { role: "assistant", content: "Noted." },
    ]);
    expect(out).toEqual([
      { role: "user", content: "I prefer carousels\nno stories" },
      { role: "assistant", content: "Noted." },
    ]);
  });

  it("skips empty bodies", () => {
    expect(normalizeChatTurns([{ role: "user", content: "  " }])).toEqual([]);
  });
});

describe("resolveConversationContextArgs", () => {
  it("keeps a numeric limit as summarize-on (backward compatible)", () => {
    expect(resolveConversationContextArgs(20)).toEqual({ limit: 20, summarize: true });
    expect(resolveConversationContextArgs()).toEqual({ limit: 15, summarize: true });
  });

  it("lets callers skip the summarize LLM", () => {
    expect(resolveConversationContextArgs({ summarize: false })).toEqual({
      limit: 15,
      summarize: false,
    });
    expect(resolveConversationContextArgs({ limit: 8, summarize: false })).toEqual({
      limit: 8,
      summarize: false,
    });
  });
});
