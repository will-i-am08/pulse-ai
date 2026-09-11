import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
const queryOne = vi.fn();
const decrypt = vi.fn();
const getServerEnv = vi.fn();
const sendToBrand = vi.fn();
const twilioSend = vi.fn();

vi.mock("@pulse/shared", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  decrypt: (...args: unknown[]) => decrypt(...args),
  getServerEnv: (...args: unknown[]) => getServerEnv(...args),
}));

vi.mock("@pulse/channel-twilio", () => ({
  createTwilioChannel: () => ({
    name: "twilio-sms",
    send: (...args: unknown[]) => twilioSend(...args),
  }),
}));

vi.mock("./gateway.js", () => ({
  sendToBrand: (...args: unknown[]) => sendToBrand(...args),
}));

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "code-1",
    phone: "+61480436685",
    user_id: "user-1",
    brand_id: "brand-1",
    code_encrypted: "enc",
    purpose: "login",
    attempts: 0,
    delivered_at: null,
    consumed_at: null,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("deliverPendingLoginCodes", () => {
  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    queryOne.mockReset();
    decrypt.mockReset();
    getServerEnv.mockReset();
    sendToBrand.mockReset();
    twilioSend.mockReset();
    getServerEnv.mockReturnValue({
      TWILIO_ACCOUNT_SID: "ACxxx",
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+61400000000",
      MESSAGE_CHANNEL: "twilio",
    });
  });

  it("sends via Twilio SMS to the login phone when configured", async () => {
    query.mockResolvedValueOnce([pendingRow({ brand_id: null })]);
    query.mockResolvedValue([]); // message insert + delivered update
    queryOne.mockResolvedValueOnce({ id: "brand-1" }); // resolveBrandId for logging
    decrypt.mockReturnValue("123456");
    twilioSend.mockResolvedValue({ providerMessageId: "SMxxx" });

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes(() => new Date());

    expect(n).toBe(1);
    expect(twilioSend).toHaveBeenCalledWith({
      to: "+61480436685",
      body: expect.stringContaining("123456"),
    });
    expect(sendToBrand).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("delivered_at = now()"),
      ["code-1"],
    );
  });

  it("falls back to sendToBrand when Twilio is not configured and channel is discord", async () => {
    getServerEnv.mockReturnValue({
      TWILIO_ACCOUNT_SID: undefined,
      TWILIO_FROM_NUMBER: undefined,
      MESSAGE_CHANNEL: "discord",
    });
    query.mockResolvedValueOnce([pendingRow({ brand_id: null })]);
    query.mockResolvedValue([]);
    queryOne.mockResolvedValueOnce({ id: "brand-1" });
    decrypt.mockReturnValue("123456");
    sendToBrand.mockResolvedValue(true);

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes(() => new Date());

    expect(n).toBe(1);
    expect(twilioSend).not.toHaveBeenCalled();
    expect(sendToBrand).toHaveBeenCalledWith(
      "brand-1",
      expect.stringContaining("123456"),
      undefined,
      { pace: false },
    );
  });

  it("does not retry via sendToBrand when Twilio SMS fails and MESSAGE_CHANNEL is twilio", async () => {
    twilioSend.mockRejectedValue(new Error("From number invalid"));
    query.mockResolvedValueOnce([pendingRow()]);
    decrypt.mockReturnValue("654321");

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes(() => new Date());

    expect(n).toBe(0);
    expect(sendToBrand).not.toHaveBeenCalled();
    expect(query.mock.calls.some((c) => String(c[0]).includes("delivered_at = now()"))).toBe(false);
  });

  it("does not mark delivered when both Twilio and sendToBrand fail", async () => {
    getServerEnv.mockReturnValue({
      TWILIO_ACCOUNT_SID: "ACxxx",
      TWILIO_AUTH_TOKEN: "token",
      TWILIO_FROM_NUMBER: "+61400000000",
      MESSAGE_CHANNEL: "discord",
    });
    twilioSend.mockRejectedValue(new Error("twilio down"));
    sendToBrand.mockResolvedValue(false);
    query.mockResolvedValueOnce([pendingRow()]);
    decrypt.mockReturnValue("654321");

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes(() => new Date());

    expect(n).toBe(0);
    expect(query.mock.calls.some((c) => String(c[0]).includes("delivered_at = now()"))).toBe(false);
  });

  it("skips rows with no resolvable brand when Twilio is unavailable", async () => {
    getServerEnv.mockReturnValue({ MESSAGE_CHANNEL: "discord" });
    query.mockResolvedValueOnce([pendingRow({ brand_id: null, phone: "+61400000001", id: "code-3" })]);
    queryOne.mockResolvedValueOnce(null);
    decrypt.mockReturnValue("111111");

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes(() => new Date());

    expect(n).toBe(0);
    expect(sendToBrand).not.toHaveBeenCalled();
  });

  it("can scope delivery to a single phone", async () => {
    query.mockResolvedValueOnce([pendingRow()]);
    query.mockResolvedValue([]);
    decrypt.mockReturnValue("999999");
    twilioSend.mockResolvedValue({ providerMessageId: "SMyyy" });

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes({ phone: "+61480436685" });

    expect(n).toBe(1);
    expect(query.mock.calls[0]?.[0]).toContain("and phone = $1");
    expect(query.mock.calls[0]?.[1]).toEqual(["+61480436685"]);
  });
});
