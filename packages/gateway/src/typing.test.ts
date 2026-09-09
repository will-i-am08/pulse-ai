import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageChannel } from "@pulse/shared";
import { splitIntoBubbles, startTypingKeeper } from "./gateway.js";
import { LinqChannel } from "./linq-channel.js";

function fakeChannel(overrides: Partial<MessageChannel> = {}): MessageChannel {
  return {
    name: "test",
    send: vi.fn().mockResolvedValue({ providerMessageId: "x" }),
    parseInbound: vi.fn() as unknown as MessageChannel["parseInbound"],
    verifySignature: () => true,
    fetchMedia: vi.fn() as unknown as MessageChannel["fetchMedia"],
    ...overrides,
  };
}

describe("splitIntoBubbles", () => {
  it("passes short texts through untouched", () => {
    expect(splitIntoBubbles("Hello there")).toEqual(["Hello there"]);
  });

  it("splits long texts on sentence boundaries without losing words", () => {
    const body =
      "Here's your post. I styled the photo too and it looks great. " +
      "Reply yes to approve, tell me what to change, or no to discard. " +
      "This final sentence pushes the total well past the soft limit for sure, " +
      "and then some extra words to make certain of it.";
    const parts = splitIntoBubbles(body, 120);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length > 0)).toBe(true);
    // Rejoining should preserve every word.
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(body.replace(/\s+/g, " "));
  });

  it("never returns empty chunks", () => {
    const parts = splitIntoBubbles("One. Two. Three. ".repeat(40), 100);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.trim().length > 0)).toBe(true);
  });
});

describe("startTypingKeeper", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires immediately and refreshes on the channel interval", () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const keeper = startTypingKeeper(fakeChannel({ sendTyping }), "+61400000000");

    expect(sendTyping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(8_000);
    expect(sendTyping).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(8_000);
    expect(sendTyping).toHaveBeenCalledTimes(3);

    keeper.stop();
    vi.advanceTimersByTime(30_000);
    expect(sendTyping).toHaveBeenCalledTimes(3);
  });

  it("uses the slower Linq refresh cadence", () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const keeper = startTypingKeeper(fakeChannel({ name: "linq", sendTyping }), "+61400000000");

    expect(sendTyping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(8_000);
    expect(sendTyping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(52_000);
    expect(sendTyping).toHaveBeenCalledTimes(2);
    keeper.stop();
  });

  it("no-ops for channels without sendTyping and never throws", () => {
    vi.useFakeTimers();
    const keeper = startTypingKeeper(fakeChannel({ sendTyping: undefined }), "+61400000000");
    vi.advanceTimersByTime(60_000);
    keeper.stop();
    keeper.stop(); // idempotent
  });

  it("survives a rejecting sendTyping", () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn().mockRejectedValue(new Error("denied"));
    const keeper = startTypingKeeper(fakeChannel({ sendTyping }), "+61400000000");
    vi.advanceTimersByTime(16_000);
    expect(sendTyping).toHaveBeenCalledTimes(3);
    keeper.stop();
  });
});

describe("LinqChannel.sendTyping", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("POSTs to the chats typing endpoint when the chat is known", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const linq = new LinqChannel("test-key");
    linq.noteChat("+61400000000", "chat-123");

    await linq.sendTyping("+61400000000");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.linqapp.com/api/partner/v3/chats/chat-123/typing");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("resolves an unknown chat via the chats list, preferring a direct iMessage chat", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/chats?to=")) {
        return new Response(
          JSON.stringify({
            chats: [
              { id: "group-1", is_group: true, service: "iMessage", updated_at: "2026-09-08T00:00:00Z" },
              { id: "direct-1", is_group: false, service: "iMessage", updated_at: "2026-09-08T01:00:00Z" },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(null, { status: 204 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const linq = new LinqChannel("test-key");

    await linq.sendTyping("+61400000000");

    const typingCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/typing"));
    expect(typingCall?.[0]).toContain("/chats/direct-1/typing");
  });

  it("never throws when the chat cannot be resolved", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ chats: [] }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const linq = new LinqChannel("test-key");

    await expect(linq.sendTyping("+61400000000")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/typing"))).toBe(false);
  });

  it("never throws when the network fails", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const linq = new LinqChannel("test-key");

    await expect(linq.sendTyping("+61400000000")).resolves.toBeUndefined();
  });
});
