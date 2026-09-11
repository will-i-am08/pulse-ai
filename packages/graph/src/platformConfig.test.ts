import { describe, it, expect, afterEach } from "vitest";
import { platformConfigured } from "./platformConfig.js";

const KEY = "TEST_PLATFORM_CONFIG_VAR";

describe("platformConfigured", () => {
  afterEach(() => {
    delete process.env[KEY];
    delete process.env.LINKEDIN_CLIENT_ID;
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.X_CLIENT_ID;
    delete process.env.THREADS_APP_ID;
  });

  it("is false when the var is unset", () => {
    delete process.env[KEY];
    expect(platformConfigured(KEY)).toBe(false);
  });

  it("is false when the var is empty", () => {
    process.env[KEY] = "";
    expect(platformConfigured(KEY)).toBe(false);
  });

  it("is true when the var is set", () => {
    process.env[KEY] = "some-app-id";
    expect(platformConfigured(KEY)).toBe(true);
  });

  it("does NOT validate the rest of the server env (the whole point)", () => {
    // No DATABASE_URL / ANTHROPIC_API_KEY / TOKEN_ENCRYPTION_KEY set here — a
    // getServerEnv()-based check would throw. This must not.
    delete process.env[KEY];
    expect(() => platformConfigured(KEY)).not.toThrow();
  });

  it("accepts platform aliases (linkedin / tiktok / x / threads)", () => {
    expect(platformConfigured("linkedin")).toBe(false);
    process.env.LINKEDIN_CLIENT_ID = "li-app";
    expect(platformConfigured("linkedin")).toBe(true);
    expect(platformConfigured("LINKEDIN_CLIENT_ID")).toBe(true);

    process.env.TIKTOK_CLIENT_KEY = "tt-key";
    expect(platformConfigured("tiktok")).toBe(true);

    process.env.X_CLIENT_ID = "x-id";
    expect(platformConfigured("x")).toBe(true);

    process.env.THREADS_APP_ID = "th-id";
    expect(platformConfigured("threads")).toBe(true);
  });
});
