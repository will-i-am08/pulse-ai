import { describe, expect, it, vi, afterEach } from "vitest";
import { mediaFromTwilioPayload, TwilioChannel } from "./twilio-channel.js";

describe("mediaFromTwilioPayload", () => {
  it("reads MediaUrl keys even when NumMedia is under-counted", () => {
    const media = mediaFromTwilioPayload({
      NumMedia: "0",
      MediaUrl0: "https://api.twilio.com/media/0",
      MediaContentType0: "image/jpeg",
    });
    expect(media).toEqual([{ url: "https://api.twilio.com/media/0", contentType: "image/jpeg" }]);
  });

  it("dedupes URLs when both NumMedia loop and key scan would see them", () => {
    const media = mediaFromTwilioPayload({
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/0",
      MediaContentType0: "image/png",
    });
    expect(media).toHaveLength(1);
  });
});

describe("TwilioChannel.parseInbound", () => {
  const channel = new TwilioChannel();

  it("parses a message with no media", () => {
    const payload = {
      From: "+61400000000",
      To: "+61400000001",
      Body: "Hello there",
      NumMedia: "0",
      MessageSid: "SM123",
    };

    const result = channel.parseInbound(payload);

    expect(result).toEqual({
      from: "+61400000000",
      to: "+61400000001",
      body: "Hello there",
      media: [],
      providerMessageId: "SM123",
      raw: payload,
    });
  });

  it("parses a message with two media attachments", () => {
    const payload = {
      From: "+61400000000",
      To: "+61400000001",
      Body: "Check these out",
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/media/0",
      MediaContentType0: "image/jpeg",
      MediaUrl1: "https://api.twilio.com/media/1",
      MediaContentType1: "video/mp4",
      MessageSid: "SM456",
    };

    const result = channel.parseInbound(payload);

    expect(result.from).toBe("+61400000000");
    expect(result.providerMessageId).toBe("SM456");
    expect(result.media).toEqual([
      { url: "https://api.twilio.com/media/0", contentType: "image/jpeg" },
      { url: "https://api.twilio.com/media/1", contentType: "video/mp4" },
    ]);
  });

  it("skips a media index when its MediaUrl is missing, even if NumMedia claims it exists", () => {
    const payload = {
      From: "+61400000000",
      To: "+61400000001",
      Body: "",
      NumMedia: "2",
      MediaUrl0: "https://api.twilio.com/media/0",
      MediaContentType0: "image/png",
      // MediaUrl1 intentionally absent
      MessageSid: "SM789",
    };

    const result = channel.parseInbound(payload);

    expect(result.media).toEqual([{ url: "https://api.twilio.com/media/0", contentType: "image/png" }]);
  });

  it("falls back to SmsSid when MessageSid is absent", () => {
    const result = channel.parseInbound({
      From: "+61400000000",
      To: "+61400000001",
      Body: "hi",
      NumMedia: "0",
      SmsSid: "SMabcdef0123456789abcdef0123456789",
    });
    expect(result.providerMessageId).toBe("SMabcdef0123456789abcdef0123456789");
  });
});

describe("TwilioChannel.send contact card media", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes the Kip.vcf MediaUrl through to Twilio messages.create", async () => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test";
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32).toString("base64");
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+61411111111";
    process.env.APP_BASE_URL = "https://kip.example";

    const { resetServerEnvCache } = await import("@pulse/shared");
    resetServerEnvCache();

    const create = vi.fn().mockResolvedValue({ sid: "SMvcf" });
    const channel = new TwilioChannel();
    // Stub the private Twilio REST client.
    (channel as unknown as { client: () => { messages: { create: typeof create } } }).client = () => ({
      messages: { create },
    });

    const vcardUrl = "https://kip.example/api/contact/kip.vcf";
    const result = await channel.send({
      to: "+61400000000",
      body: "Your Kip login code is 123456.",
      mediaUrls: [vcardUrl],
    });

    expect(result.providerMessageId).toBe("SMvcf");
    expect(create).toHaveBeenCalledWith({
      to: "+61400000000",
      from: "+61411111111",
      body: "Your Kip login code is 123456.",
      mediaUrl: [vcardUrl],
    });
  });
});

describe("TwilioChannel.send retry contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function stubbedChannel(create: ReturnType<typeof vi.fn>) {
    process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "test";
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY || Buffer.alloc(32).toString("base64");
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+61411111111";
    process.env.APP_BASE_URL = "https://kip.example";

    const { resetServerEnvCache } = await import("@pulse/shared");
    resetServerEnvCache();

    const channel = new TwilioChannel();
    (channel as unknown as { client: () => { messages: { create: typeof create } } }).client = () => ({
      messages: { create },
    });
    return channel;
  }

  // Regression: this class used to retry messages.create internally on timeout,
  // while gateway.sendToBrand ALSO wrapped it in withBackoff({retries: 3}) —
  // one client-side timeout became up to SIX create calls. A Twilio timeout
  // does not mean the send was rejected; Twilio commonly accepts and queues,
  // so every extra attempt was a separately billed, separately delivered
  // duplicate SMS to a paying client. Retry policy belongs to the caller only
  // (see the MessageChannel contract in @pulse/shared channel.ts).
  it("does not retry internally on a timeout — exactly one create call", async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error("ETIMEDOUT: socket hang up"), { code: "ETIMEDOUT" }),
    );
    const channel = await stubbedChannel(create);

    await expect(
      channel.send({ to: "+61400000000", body: "hello" }),
    ).rejects.toThrow(/ETIMEDOUT/);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not retry internally on any other error either", async () => {
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error("Twilio 21610: recipient has opted out"), { status: 400 }),
    );
    const channel = await stubbedChannel(create);

    await expect(channel.send({ to: "+61400000000", body: "hello" })).rejects.toThrow(/21610/);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
