import { describe, expect, it } from "vitest";
import { normalizeChatTurns } from "../conversationContext.js";

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
