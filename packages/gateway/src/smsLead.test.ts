import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();

vi.mock("@pulse/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulse/shared")>();
  return {
    ...actual,
    query: (...args: unknown[]) => query(...args),
    appBaseUrl: () => "https://kip.example",
  };
});

const send = vi.fn();
const channel = { name: "twilio-sms", send };

describe("handleUnknownInbound", () => {
  beforeEach(() => {
    query.mockReset();
    send.mockReset();
    send.mockResolvedValue({ providerMessageId: "SMlead" });
    process.env.APP_BASE_URL = "https://kip.example";
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  async function load() {
    const { resetServerEnvCache } = await import("@pulse/shared");
    resetServerEnvCache();
    return import("./smsLead.js");
  }

  it("sends a welcome with a signup link and does not require a brand", async () => {
    query.mockResolvedValueOnce([
      { phone: "+61412345678", last_replied_at: null, last_provider_message_id: "SM1" },
    ]);
    query.mockResolvedValueOnce([]);
    const { handleUnknownInbound } = await load();
    const result = await handleUnknownInbound({
      from: "+61412345678",
      body: "Hi Kip flyer",
      providerMessageId: "SM1",
      channel: channel as never,
    });
    expect(result).toEqual({ replied: true, kind: "welcome" });
    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0]?.[0]?.body as string;
    expect(body).toContain("I'm Kip");
    expect(body).toContain("https://kip.example/signup?from=sms&phone=0412345678&src=flyer");
    expect(query.mock.calls[0]?.[1]).toEqual(["+61412345678", "flyer", "Hi Kip flyer", "SM1"]);
  });

  it("skips a retried provider message id", async () => {
    query.mockResolvedValueOnce([]);
    const { handleUnknownInbound } = await load();
    const result = await handleUnknownInbound({
      from: "+61412345678",
      body: "Hi Kip",
      providerMessageId: "SM1",
      channel: channel as never,
    });
    expect(result).toEqual({ replied: false, kind: "skipped" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the short link again inside the cooldown", async () => {
    query.mockResolvedValueOnce([
      {
        phone: "+61412345678",
        last_replied_at: new Date().toISOString(),
        last_provider_message_id: "SM2",
      },
    ]);
    query.mockResolvedValueOnce([]);
    const { handleUnknownInbound } = await load();
    const result = await handleUnknownInbound({
      from: "+61412345678",
      body: "Hi Kip",
      providerMessageId: "SM2",
      channel: channel as never,
    });
    expect(result).toEqual({ replied: true, kind: "repeat" });
    expect(send.mock.calls[0]?.[0]?.body).toContain("Here's the link again");
  });

  it("does not reply to STOP", async () => {
    query.mockResolvedValueOnce([
      { phone: "+61412345678", last_replied_at: null, last_provider_message_id: "SM3" },
    ]);
    const { handleUnknownInbound } = await load();
    const result = await handleUnknownInbound({
      from: "+61412345678",
      body: "STOP",
      providerMessageId: "SM3",
      channel: channel as never,
    });
    expect(result).toEqual({ replied: false, kind: "opt_out" });
    expect(send).not.toHaveBeenCalled();
  });

  it("replies to HELP with the signup URL", async () => {
    query.mockResolvedValueOnce([
      { phone: "+61412345678", last_replied_at: null, last_provider_message_id: "SM4" },
    ]);
    query.mockResolvedValueOnce([]);
    const { handleUnknownInbound } = await load();
    const result = await handleUnknownInbound({
      from: "+61412345678",
      body: "HELP",
      providerMessageId: "SM4",
      channel: channel as never,
    });
    expect(result).toEqual({ replied: true, kind: "help" });
    expect(send.mock.calls[0]?.[0]?.body).toContain("https://kip.example/signup");
    expect(send.mock.calls[0]?.[0]?.body).toContain("STOP");
  });
});
