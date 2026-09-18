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

vi.mock("../conversationContext.js", () => ({
  loadRecentChatTurns: vi.fn(async () => []),
}));

vi.mock("../speak/openLoops.js", () => ({
  scheduleOpenLoopsUpdate: vi.fn(),
}));

vi.mock("../kipMemory.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kipMemory.js")>();
  return {
    ...actual,
    recordKipMemory: vi.fn(async (brand: Brand, text: string, bucket: string) => {
      brand.facts = actual.mergeKipMemoryFact(brand.facts, bucket as "kip_preferences", text);
      return brand.facts;
    }),
  };
});

vi.mock("../kickoffs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../kickoffs.js")>();
  return {
    ...actual,
    maybeEnqueueFromKipCommit: vi.fn(async () => null),
  };
});

import { callLLMWithTools } from "../llm.js";
import { retrieveBrandContext } from "../retrieveContext.js";
import { loadRecentChatTurns } from "../conversationContext.js";
import { maybeEnqueueFromKipCommit } from "../kickoffs.js";
import { recordKipMemory } from "../kipMemory.js";
import { scheduleOpenLoopsUpdate } from "../speak/openLoops.js";
import { generalAgentEligible, runGeneralAgent } from "../runGeneralAgent.js";

const mockedTools = callLLMWithTools as unknown as ReturnType<typeof vi.fn>;
const mockedRetrieve = retrieveBrandContext as unknown as ReturnType<typeof vi.fn>;
const mockedCommit = maybeEnqueueFromKipCommit as unknown as ReturnType<typeof vi.fn>;
const mockedHistory = loadRecentChatTurns as unknown as ReturnType<typeof vi.fn>;
const mockedLoops = scheduleOpenLoopsUpdate as unknown as ReturnType<typeof vi.fn>;
const mockedRemember = recordKipMemory as unknown as ReturnType<typeof vi.fn>;

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
    mockedHistory.mockReset();
    mockedLoops.mockReset();
    mockedRemember.mockClear();
    mockedTools.mockResolvedValue("Here's the draft from tools.");
    mockedRetrieve.mockResolvedValue({
      text: "ICP: busy cafe owners. Offer: weekday lunch special.",
      sections: ["facts"],
      chars: 52,
    });
    mockedCommit.mockResolvedValue(null);
    mockedHistory.mockResolvedValue([]);
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

  it("skips maybeEnqueueFromKipCommit when draft_copy already ran this turn", async () => {
    mockedTools.mockImplementationOnce(async (arg: {
      toolExecutor: (name: string, input: unknown) => Promise<string>;
    }) => {
      await arg.toolExecutor("draft_copy", { job: "post", topic_hint: "hiring barista" });
      return "On it — drafting that LinkedIn post now.";
    });
    const brand = stubBrand();
    await runGeneralAgent({
      brand,
      ownerMessage: "Draft a LinkedIn post about hiring a barista — photo please",
      sourceMessageId: "msg-li",
    });
    expect(mockedCommit).not.toHaveBeenCalled();
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
    expect(out.reply.toLowerCase()).toMatch(/snag|retry|go/);
    expect(out.reply.toLowerCase()).not.toMatch(/sending it again/);
    expect(mockedCommit).toHaveBeenCalledWith(brand, "draft a post", out.reply, "msg-err");
  });

  it("surfaces operatorAlert from escalate_to_human without putting it in the owner reply", async () => {
    mockedTools.mockImplementationOnce(async (arg: { toolExecutor: (name: string, input: unknown) => Promise<string> }) => {
      await arg.toolExecutor("escalate_to_human", { reason: "blocked", summary: "need a human" });
      return "I'll look into this and come back to you.";
    });
    const out = await runGeneralAgent({
      brand: stubBrand(),
      ownerMessage: "this is a legal question",
    });
    expect(out.operatorAlert).toMatch(/Sunrise Cafe/);
    expect(out.operatorAlert).toMatch(/blocked/);
    expect(out.reply.toLowerCase()).not.toMatch(/operator|agency/);
    expect(out.reply).not.toBe(out.operatorAlert);
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

  it("prepends recent chat turns before the current user message", async () => {
    mockedHistory.mockResolvedValueOnce([
      { role: "user", content: "I prefer carousels" },
      { role: "assistant", content: "Noted." },
    ]);
    await runGeneralAgent({
      brand: stubBrand(),
      ownerMessage: "what should we post?",
      sourceMessageId: "msg-now",
    });
    expect(mockedHistory).toHaveBeenCalledWith("brand-1", { excludeMessageId: "msg-now" });
    const messages = mockedTools.mock.calls[0]![0].messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "user", content: "I prefer carousels" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Noted." });
    expect(messages[2]?.content).toMatch(/what should we post/);
  });

  it("updates open loops after a reply and cheap-saves a durable pref", async () => {
    const brand = stubBrand();
    const out = await runGeneralAgent({
      brand,
      ownerMessage: "I prefer shorter captions",
      sourceMessageId: "msg-pref",
    });
    expect(mockedLoops).toHaveBeenCalledWith(brand, "I prefer shorter captions", out.reply);
    expect(mockedRemember).toHaveBeenCalled();
    expect(String(mockedRemember.mock.calls[0]![1])).toMatch(/prefer shorter/i);
  });

  it("does not cheap-save a pref when remember_fact already ran", async () => {
    mockedTools.mockImplementationOnce(async (arg: { toolExecutor: (name: string, input: unknown) => Promise<string> }) => {
      await arg.toolExecutor("remember_fact", { text: "prefer carousels", bucket: "kip_preferences" });
      return "Got it.";
    });
    await runGeneralAgent({
      brand: stubBrand(),
      ownerMessage: "I prefer carousels",
    });
    expect(mockedRemember).toHaveBeenCalledTimes(1);
  });
});

describe("generalAgentEligible", () => {
  it("is false when the flag is off", () => {
    expect(generalAgentEligible({ flag: false, hasMedia: false, hasPending: false })).toBe(false);
  });

  it("is false when the flag is on and there is media", () => {
    expect(generalAgentEligible({ flag: true, hasMedia: true, hasPending: false })).toBe(false);
  });

  it("is true when the flag is on with a pending draft (agent owns draft mutation)", () => {
    expect(generalAgentEligible({ flag: true, hasMedia: false, hasPending: true })).toBe(true);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: true,
        ownerMessage: "remove the text",
      }),
    ).toBe(true);
  });

  it("is false for high-confidence approval when a draft is pending", () => {
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: true,
        ownerMessage: "yes",
      }),
    ).toBe(false);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: true,
        ownerMessage: "looks good",
      }),
    ).toBe(false);
  });

  it("is true when the flag is on with no media — including kickoff-shaped asks", () => {
    expect(generalAgentEligible({ flag: true, hasMedia: false, hasPending: false })).toBe(true);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: false,
        ownerMessage: "what's on this week?",
      }),
    ).toBe(true);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: false,
        ownerMessage: "draft me 3 posts",
      }),
    ).toBe(true);
    expect(
      generalAgentEligible({
        flag: true,
        hasMedia: false,
        hasPending: false,
        ownerMessage: "make a reel",
      }),
    ).toBe(true);
  });
});

describe("processInbound general-agent insert", () => {
  it("sits after digest and calendar, after greetings", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../processInbound.ts"),
      "utf8",
    );
    const digestIdx = src.indexOf("looksLikeDigestRequest(message.body)");
    const calendarIdx = src.indexOf("looksLikeCalendarAsk(message.body)");
    const greetingIdx = src.indexOf("looksLikeGreeting(message.body)");
    const agentIdx = src.indexOf("generalAgentEligible({");
    expect(digestIdx).toBeGreaterThan(-1);
    expect(calendarIdx).toBeGreaterThan(digestIdx);
    expect(greetingIdx).toBeGreaterThan(calendarIdx);
    expect(agentIdx).toBeGreaterThan(greetingIdx);
    expect(src).toMatch(/KIP_GENERAL_AGENT/);
    expect(src).toMatch(/runGeneralAgent/);
    expect(src).toMatch(/operatorAlert: out\.operatorAlert/);
    const converseFn = src.slice(src.indexOf("async function converse"), src.indexOf("async function reengage"));
    expect(converseFn.indexOf("quickSocialReply")).toBeGreaterThan(-1);
    expect(converseFn.indexOf("quickSocialReply")).toBeLessThan(converseFn.indexOf("buildConversationContext"));
    const reFn = src.slice(src.indexOf("async function reengage"), src.indexOf("export type InboundResult"));
    expect(reFn.indexOf("quickReengageReply")).toBeGreaterThan(-1);
    expect(reFn.indexOf("quickReengageReply")).toBeLessThan(reFn.indexOf("buildConversationContext"));
    expect(reFn).toMatch(/summarize:\s*false/);
    expect(reFn).toMatch(/think:\s*false/);
  });

  it("question path threads operatorAlert and does not double-enqueue when the general agent is on", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../processInbound.ts"),
      "utf8",
    );
    const q = src.slice(src.indexOf('case "question"'), src.indexOf('case "instruction"'));
    expect(q).toMatch(/operatorAlert: out\.operatorAlert/);
    expect(q).toMatch(/KIP_GENERAL_AGENT/);
    expect(q).toMatch(/maybeEnqueueFromKipCommitIfAsked/);
  });
});
