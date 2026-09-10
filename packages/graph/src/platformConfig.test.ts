import { describe, it, expect, afterEach } from "vitest";
import { platformConfigured } from "./platformConfig.js";

const KEY = "TEST_PLATFORM_CONFIG_VAR";

describe("platformConfigured", () => {
  afterEach(() => {
    delete process.env[KEY];
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
});
