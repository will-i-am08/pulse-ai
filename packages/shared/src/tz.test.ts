import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_TZ,
  appTz,
  isValidIanaTimeZone,
  normalizeTimeZoneCandidate,
  resolveAppTz,
} from "./tz.js";

describe("normalizeTimeZoneCandidate", () => {
  it("strips the leading colon from :UTC", () => {
    expect(normalizeTimeZoneCandidate(":UTC")).toBe("UTC");
  });

  it("returns null for empty / whitespace", () => {
    expect(normalizeTimeZoneCandidate("")).toBeNull();
    expect(normalizeTimeZoneCandidate("   ")).toBeNull();
    expect(normalizeTimeZoneCandidate(null)).toBeNull();
    expect(normalizeTimeZoneCandidate(undefined)).toBeNull();
    expect(normalizeTimeZoneCandidate(":")).toBeNull();
  });

  it("aliases GMT-style names to UTC", () => {
    expect(normalizeTimeZoneCandidate("Etc/UTC")).toBe("UTC");
    expect(normalizeTimeZoneCandidate("GMT")).toBe("UTC");
  });
});

describe("isValidIanaTimeZone", () => {
  it("accepts real IANA ids", () => {
    expect(isValidIanaTimeZone("UTC")).toBe(true);
    expect(isValidIanaTimeZone("Australia/Sydney")).toBe(true);
  });

  it("rejects Vercel junk and empty", () => {
    expect(isValidIanaTimeZone(":UTC")).toBe(false);
    expect(isValidIanaTimeZone("")).toBe(false);
    expect(isValidIanaTimeZone("Not/AZone")).toBe(false);
  });
});

describe("resolveAppTz", () => {
  it("falls back to Australia/Sydney when candidates are empty/invalid", () => {
    expect(resolveAppTz("", null, "Not/AZone")).toBe(DEFAULT_APP_TZ);
  });

  it("prefers the first valid candidate", () => {
    expect(resolveAppTz("Australia/Brisbane", "UTC")).toBe("Australia/Brisbane");
  });

  it("accepts normalized :UTC as UTC at the low-level helper", () => {
    expect(resolveAppTz(":UTC")).toBe("UTC");
  });
});

describe("appTz under Vercel-style TZ=:UTC", () => {
  it("uses Australia/Sydney (not UTC) and never throws in Intl", () => {
    const prev = process.env.TZ;
    const prevPulse = process.env.PULSE_APP_TZ;
    try {
      process.env.TZ = ":UTC";
      delete process.env.PULSE_APP_TZ;
      const tz = appTz();
      expect(tz).toBe(DEFAULT_APP_TZ);
      expect(isValidIanaTimeZone(tz)).toBe(true);
      expect(() =>
        new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "long" }).format(new Date()),
      ).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
      if (prevPulse === undefined) delete process.env.PULSE_APP_TZ;
      else process.env.PULSE_APP_TZ = prevPulse;
    }
  });
});
