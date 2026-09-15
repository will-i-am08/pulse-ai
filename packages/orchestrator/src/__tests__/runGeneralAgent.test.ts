import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Brand } from "@pulse/shared";

vi.mock("../llm.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../llm.js")>();
  return {
    ...actual,
    callLLMWithTools: vi.fn(async () => "Here's the draft from tools."),
  };
});

vi.mock("../retrieveContext.js", () => ({
  retrieveBrandContext: vi.fn(async () => ({
    text: "ICP: busy cafe owners. Offer: weekday lunch special.",
    sections: ["facts"],
    chars: 52,
  })),
}));

vi.mock("../kickoffs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kickoffs.js")>();
  return {
    ...actual,
    maybeEnqueueFromKipCommit: vi.fn(async () => null),
  };
});

import { callLLMWithTools } from "../llm.js";
import { retrieveBrandContext } from "../retrieveContext.js";
import { maybeEnqueueFromKipCommit } from "../kickoffs.js";
import { generalAgentEligible, runGeneralAgent } from "../runGeneralAgent.js";

const mockedTools = callLLMWithTools as unknown as ReturnType<typeof vi.fn>;
const mockedRetrieve = retrieveBrandContext as unknown as ReturnType<typeof vi.fn>;
const mockedCommit = maybeEnqueueFromKipCommit as unknown as ReturnType<typeof vi.fn>;

function stubBrand(): Brand {
  return {
    id: "brand-1",
    name: "Sunrise Cafe",
    facts: { owner_name: "Sam" },
    brand_voice_profile: { tone: ["warm"] },
  } as Brand;
}

describe("runGeneralAgent", () => {
  beforeEach(() => {
    mockedTools.mockReset();
    mockedRetrieve.mockReset();
    mockedCommit.mockReset();
    mockedTools.mockResolvedValue("Here's the draft from tools.");
    mockedRetrieve.mockResolvedValue({
      text: "ICP: busy cafe owners. Offer: weekday lunch special.",
      sections: ["facts"],
      chars: 52,
    });
    mockedCommit.mockResolvedValue(null);
  });

  it("retrieves context then calls callLLMWithTools with general_agent / 4 rounds / draft_copy", async () => {
    const brand = stubBrand();
    const ownerMessage = "Draft 3 posts about coffee";
    await runGeneralAgent({
      brand,
      ownerMessage,
      sourceMessageId: "msg-1",
      mediaIds: [],
    });

    expect(mockedRetrieve).toHaveBeenCalledTimes(1);
    expect(mockedRetrieve).toHaveBeenCalledWith(brand, ownerMessage);
    expect(mockedTools).toHaveBeenCalledTimes(1);
    expect(mockedRetrieve.mock.invocationCallOrder[0]).toBeLessThan(
      mockedTools.mock.invocationCallOrder[0]!,
    );

    const arg = mockedTools.mock.calls[0]![0];
    expect(arg.tier).toBe("smart");
    expect(arg.task).toBe("general_agent");
    expect(arg.maxRounds).toBe(4);
    expect(arg.maxTokens).toBe(700);
    expect(arg.temperature).toBe(0.7);
    expect(typeof arg.toolExecutor).toBe("function");
    const toolNames = (arg.tools ?? []).map((t: { name: string }) => t.name);
    expect(toolNames).toContain("draft_copy");
    expect(arg.messages[0].content).toMatch(/Draft 3 posts about coffee/);
  });

  it("puts draft_copy-before-SMS judgment in the system prompt", async () => {
    await runGeneralAgent({ brand: stubBrand(), ownerMessage: "make a carousel" });
    const arg = mockedTools.mock.calls[0]![0];
    expect(arg.system).toMatch(/must tool-call|draft_copy before/i);
    expect(arg.system).toMatch(/draft_copy/);
    expect(arg.system).toContain("ICP: busy cafe owners. Offer: weekday lunch special.");
  });

  it("humanizes and strips markdown from the model reply", async () => {
    mockedTools.mockResolvedValueOnce("**Bold** answer with `code`");
    const out = await runGeneralAgent({ brand: stubBrand(), ownerMessage: "hi?" });
    expect(out.reply).not.toMatch(/\*\*/);
    expect(out.reply).not.toMatch(/`/);
    expect(out.reply).toMatch(/Bold answer/);
  });

  it("calls maybeEnqueueFromKipCommit with owner message + reply after the turn", async () => {
    const brand = stubBrand();
    const ownerMessage = "Write me some posts";
    const out = await runGeneralAgent({
      brand,
      ownerMessage,
      sourceMessageId: "msg-9",
    });
    expect(mockedCommit).toHaveBeenCalledTimes(1);
    expect(mockedCommit).toHaveBeenCalledWith(brand, ownerMessage, out.reply, "msg-9");
    expect(mockedTools.mock.invocationCallOrder[0]).toBeLessThan(
      mockedCommit.mock.invocationCallOrder[0]!,
    );
  });

  it("returns an in-character fallback and still tries the kickoff net when the tool loop throws", async () => {
    mockedTools.mockRejectedValueOnce(new Error("llm down"));
    const brand = stubBrand();
    const out = await runGeneralAgent({
      brand,
      ownerMessage: "draft a post",
      sourceMessageId: "msg-err",
    });
    expect(out.reply.length).toBeGreaterThan(0);
    expect(out.reply.toLowerCase()).not.toMatch(/operator|agency/);
    expect(mockedCommit).toHaveBeenCalledWith(brand, "draft a post", out.reply, "msg-err");
  });

  it("notes attached media ids on the user message", async () => {
    await runGeneralAgent({
      brand: stubBrand(),
      ownerMessage: "use these",
      mediaIds: ["media-a", "media-b"],
    });
    const content = mockedTools.mock.calls[0]![0].messages[0].content as string;
    expect(content).toMatch(/use these/);
    expect(content).toMatch(/media-a/);
    expect(content).toMatch(/media-b/);
  });
});

describe("generalAgentEligible", () => {
  it("is false when the flag is off", () => {
    expect(generalAgentEligible({ flag: false, hasMedia: false, hasPending: false })).toBe(false);
  });

  it("is false when the flag is on and there is media", () => {
    expect(generalAgentEligible({ flag: true, hasMedia: true, hasPending: false })).toBe(false);
  });

  it("is false when the flag is on and there is a pending draft", () => {
    expect(generalAgentEligible({ flag: true, hasMedia: false, hasPending: true })).toBe(false);
  });

  it("is true when the flag is on with no media and no pending draft", () => {
    expect(generalAgentEligible({ flag: true, hasMedia: false, hasPending: false })).toBe(true);
  });
});

describe("processInbound general-agent insert", () => {
  it("sits after the connect/ads/digest block and before GREETING_RE", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../processInbound.ts"),
      "utf8",
    );
    const digestIdx = src.indexOf("looksLikeDigestRequest(message.body)");
    const agentIdx = src.indexOf("generalAgentEligible({");
    const greetingIdx = src.indexOf("GREETING_RE.test(message.body)");
    expect(digestIdx).toBeGreaterThan(-1);
    expect(agentIdx).toBeGreaterThan(digestIdx);
    expect(greetingIdx).toBeGreaterThan(agentIdx);
    expect(src).toMatch(/KIP_GENERAL_AGENT/);
    expect(src).toMatch(/runGeneralAgent/);
  });
});
