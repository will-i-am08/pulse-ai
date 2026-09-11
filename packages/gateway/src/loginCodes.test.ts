import { describe, it, expect, vi, beforeEach } from "vitest";

const query = vi.fn();
const queryOne = vi.fn();
const decrypt = vi.fn();
const sendToBrand = vi.fn();

vi.mock("@pulse/shared", () => ({
  query: (...args: unknown[]) => query(...args),
  queryOne: (...args: unknown[]) => queryOne(...args),
  decrypt: (...args: unknown[]) => decrypt(...args),
}));

vi.mock("./gateway.js", () => ({
  sendToBrand: (...args: unknown[]) => sendToBrand(...args),
}));

describe("deliverPendingLoginCodes", () => {
  beforeEach(() => {
    vi.resetModules();
    query.mockReset();
    queryOne.mockReset();
    decrypt.mockReset();
    sendToBrand.mockReset();
  });

  it("resolves brand by client_phone when brand_id is null, then delivers", async () => {
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    query.mockResolvedValueOnce([
      {
        id: "code-1",
        phone: "+61480436685",
        user_id: "user-1",
        brand_id: null,
        code_encrypted: "enc",
        purpose: "login",
        attempts: 0,
        delivered_at: null,
        consumed_at: null,
        expires_at: expires,
        created_at: new Date().toISOString(),
      },
    ]);
    // backfill update
    query.mockResolvedValue([]);
    queryOne.mockResolvedValueOnce({ id: "brand-1" });
    decrypt.mockReturnValue("123456");
    sendToBrand.mockResolvedValue(true);

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes(() => new Date());

    expect(n).toBe(1);
    expect(queryOne).toHaveBeenCalledWith(
      expect.stringContaining("client_phone"),
      ["+61480436685"],
    );
    expect(sendToBrand).toHaveBeenCalledWith("brand-1", expect.stringContaining("123456"));
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("delivered_at = now()"),
      ["code-1"],
    );
  });

  it("does not mark delivered when sendToBrand returns false", async () => {
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    query.mockResolvedValueOnce([
      {
        id: "code-2",
        phone: "+61411111111",
        user_id: "user-2",
        brand_id: "brand-2",
        code_encrypted: "enc",
        purpose: "login",
        attempts: 0,
        delivered_at: null,
        consumed_at: null,
        expires_at: expires,
        created_at: new Date().toISOString(),
      },
    ]);
    decrypt.mockReturnValue("654321");
    sendToBrand.mockResolvedValue(false);

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes(() => new Date());

    expect(n).toBe(0);
    expect(query.mock.calls.some((c) => String(c[0]).includes("delivered_at = now()"))).toBe(false);
  });

  it("skips rows with no resolvable brand", async () => {
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    query.mockResolvedValueOnce([
      {
        id: "code-3",
        phone: "+61400000001",
        user_id: "user-3",
        brand_id: null,
        code_encrypted: "enc",
        purpose: "login",
        attempts: 0,
        delivered_at: null,
        consumed_at: null,
        expires_at: expires,
        created_at: new Date().toISOString(),
      },
    ]);
    queryOne.mockResolvedValueOnce(null);

    const { deliverPendingLoginCodes } = await import("./loginCodes.js");
    const n = await deliverPendingLoginCodes(() => new Date());

    expect(n).toBe(0);
    expect(sendToBrand).not.toHaveBeenCalled();
  });
});
