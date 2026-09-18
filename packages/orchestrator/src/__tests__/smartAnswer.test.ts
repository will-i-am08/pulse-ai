import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Brand } from "@pulse/shared";

vi.mock("../llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm.js")>();
  return {
    ...actual,
    callLLMWithTools: vi.fn(async () => "Here's the answer from tools."),
  };
});

import { callLLMWithTools } from "../llm.js";
import { answerWithTools } from "../smartAnswer.js";

const mockedTools = callLLMWithTools as unknown as ReturnType<typeof vi.fn>;

function stubBrand(): Brand {
  return {
    id: "brand-1",
    name: "Test Co",
    facts: {},
    brand_voice_profile: { tone: ["warm"] },
  } as Brand;
}

describe("answerWithTools", () => {
  beforeEach(() => {
    mockedTools.mockClear();
    mockedTools.mockResolvedValue("Here's the answer from tools.");
  });

  it("calls callLLMWithTools with smart tier / smart_answer and humanizes output", async () => {
    const out = await answerWithTools(stubBrand(), "(prior chat)", "What's on my calendar?");
    expect(out).toMatch(/answer from tools/i);
    expect(mockedTools).toHaveBeenCalledTimes(1);
    const arg = mockedTools.mock.calls[0]![0];
    expect(arg.tier).toBe("smart");
    expect(arg.task).toBe("smart_answer");
    expect(arg.maxRounds).toBe(3);
    expect(arg.tools?.length).toBeGreaterThanOrEqual(5);
    const toolNames = (arg.tools ?? []).map((t: { name: string }) => t.name);
    expect(toolNames).toContain("draft_copy");
    expect(toolNames).not.toContain("get_brand_profile");
    expect(typeof arg.toolExecutor).toBe("function");
    expect(arg.system).toMatch(/NEVER publish/i);
    expect(arg.messages[0].content).toMatch(/What's on my calendar/);
  });

  it("strips markdown from the tool-loop draft", async () => {
    mockedTools.mockResolvedValueOnce("**Bold** answer with `code`");
    const out = await answerWithTools(stubBrand(), "", "hi?");
    expect(out).not.toMatch(/\*\*/);
    expect(out).not.toMatch(/`/);
    expect(out).toMatch(/Bold answer/);
  });
});
