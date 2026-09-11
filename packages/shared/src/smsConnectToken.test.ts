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
