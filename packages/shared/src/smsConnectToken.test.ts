import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL = { ...process.env };

describe("smsConnectToken", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.DATABASE_URL = "postgres://localhost/test";
    process.env.ANTHROPIC_API_KEY = "test";
    process.env.APP_BASE_URL = "https://kip.example";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("round-trips a valid meta token", async () => {
    const { mintSmsConnectToken, verifySmsConnectToken, resetServerEnvCache } = await import("./index.js");
    resetServerEnvCache();
    const token = mintSmsConnectToken("brand-abc", "meta", 1_000_000);
    const res = verifySmsConnectToken(token, 1_000_000 + 60_000);
    expect(res).toEqual({ ok: true, brandId: "brand-abc", purpose: "meta" });
  });

  it("round-trips linkedin, tiktok, and crm purposes", async () => {
    const { mintSmsConnectToken, verifySmsConnectToken, resetServerEnvCache } = await import("./index.js");
    resetServerEnvCache();
    const li = mintSmsConnectToken("brand-abc", "linkedin", 1_000_000);
    const tt = mintSmsConnectToken("brand-abc", "tiktok", 1_000_000);
    const crm = mintSmsConnectToken("brand-abc", "crm", 1_000_000);
    expect(verifySmsConnectToken(li, 1_000_000 + 1_000)).toEqual({
      ok: true,
      brandId: "brand-abc",
      purpose: "linkedin",
    });
    expect(verifySmsConnectToken(tt, 1_000_000 + 1_000)).toEqual({
      ok: true,
      brandId: "brand-abc",
      purpose: "tiktok",
    });
    expect(verifySmsConnectToken(crm, 1_000_000 + 1_000)).toEqual({
      ok: true,
      brandId: "brand-abc",
      purpose: "crm",
    });
  });

  it("reports expired distinctly", async () => {
    const { mintSmsConnectToken, verifySmsConnectToken, resetServerEnvCache, SMS_CONNECT_TTL_MS } =
      await import("./index.js");
    resetServerEnvCache();
    const token = mintSmsConnectToken("brand-abc", "ads", 1_000_000);
    const res = verifySmsConnectToken(token, 1_000_000 + SMS_CONNECT_TTL_MS + 1);
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampered tokens", async () => {
    const { mintSmsConnectToken, verifySmsConnectToken, resetServerEnvCache } = await import("./index.js");
    resetServerEnvCache();
    const token = mintSmsConnectToken("brand-abc", "meta", 1_000_000);
    const res = verifySmsConnectToken(token.slice(0, -2) + "xx", 1_000_000);
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });
});
