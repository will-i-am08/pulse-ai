import { describe, it, expect } from "vitest";
import { normalizePhone, generateLoginCode, maskPhone } from "@pulse/shared";

describe("normalizePhone", () => {
  it("keeps an international +61 number, stripping spaces/punctuation", () => {
    expect(normalizePhone("+61 412 345 678")).toBe("+61412345678");
    expect(normalizePhone("+61-412-345-678")).toBe("+61412345678");
  });

  it("converts an AU trunk-0 mobile to E.164", () => {
    expect(normalizePhone("0412 345 678")).toBe("+61412345678");
    expect(normalizePhone("0412345678")).toBe("+61412345678");
  });

  it("handles 00-prefixed international dialling", () => {
    expect(normalizePhone("0061412345678")).toBe("+61412345678");
  });

  it("adds the country code to a bare national number", () => {
    expect(normalizePhone("412345678")).toBe("+61412345678");
  });

  it("respects an explicit NZ default", () => {
    expect(normalizePhone("021 123 4567", "NZ")).toBe("+64211234567");
  });

  it("does not double-prefix a number already carrying its country code", () => {
    expect(normalizePhone("61412345678")).toBe("+61412345678");
  });

  it("rejects empty or too-short input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("+123")).toBeNull();
  });

  it("is idempotent — normalising an already-normalised number is stable", () => {
    const once = normalizePhone("0412 345 678")!;
    expect(normalizePhone(once)).toBe(once);
  });
});

describe("generateLoginCode", () => {
  it("returns a zero-padded 6-digit numeric string", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLoginCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("maskPhone", () => {
  it("hides the middle, keeping the last three digits", () => {
    const masked = maskPhone("+61412345678");
    expect(masked).toContain("678");
    expect(masked).not.toContain("2345");
  });
});
