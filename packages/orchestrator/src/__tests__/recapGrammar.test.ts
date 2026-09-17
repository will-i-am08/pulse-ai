import { describe, expect, it } from "vitest";
import {
  formatDontForRecap,
  normalizeDontForRecap,
  voiceRecapSms,
} from "../voice/recapGrammar.js";

const STAY_CLEAR_BAD = /I'll stay clear of (show|be|use|skip)\b/i;

describe("normalizeDontForRecap", () => {
  it("strips directive prefixes repeatedly", () => {
    expect(normalizeDontForRecap("Don't never skip using this")).toMatch(/this/);
    expect(normalizeDontForRecap("do not sell hard")).toBe("sell hard");
  });

  it("rewrites be-adjectival to tone", () => {
    expect(normalizeDontForRecap("be overly casual or jokey")).toBe(
      "overly casual or jokey tone",
    );
  });
});

describe("formatDontForRecap", () => {
  it("routes sell to I won't", () => {
    expect(formatDontForRecap("Don't sell hard")).toBe("I won't sell hard.");
  });

  it("stays clear of faces after stripping show", () => {
    expect(formatDontForRecap("show faces or personal content")).toBe(
      "I'll stay clear of faces or personal content.",
    );
  });

  it("stays clear of casual tone after rewriting be", () => {
    expect(formatDontForRecap("be overly casual or jokey")).toBe(
      "I'll stay clear of overly casual or jokey tone.",
    );
  });
});

describe("voiceRecapSms grammar", () => {
  it("live mechanic strings are grammatical (show faces / be overly casual)", () => {
    const sms = voiceRecapSms(
      ["warm"],
      ["show faces or personal content", "be overly casual or jokey"],
    );
    expect(sms).not.toMatch(STAY_CLEAR_BAD);
    expect(sms).toMatch(/I'll stay clear of faces or personal content/i);
    expect(sms).toMatch(/I'll stay clear of overly casual or jokey tone/i);
  });

  it("#134 use jokes does not say I'll skip use", () => {
    const sms = voiceRecapSms(["warm", "direct"], ["use jokes in captions"]);
    expect(sms).toMatch(/I'll stay clear of jokes in captions/i);
    expect(sms).not.toMatch(/I'll skip use/i);
  });

  it("Don't sell hard → I won't sell hard", () => {
    const sms = voiceRecapSms(["direct"], ["Don't sell hard"]);
    expect(sms).toMatch(/I won't sell hard/i);
  });

  it("never I'll stay clear of show|be|use|skip", () => {
    const samples = [
      ["show faces or personal content", "be overly casual or jokey"],
      ["use jokes in captions", "Don't sell hard"],
      ["skip use jokes", "avoid being salesy"],
      ["don't show faces", "never be overly casual"],
      ["no slang", "stop shouting"],
      ["show faces", "be overly casual"],
      ["don't use", "skip"],
      ["be", "use"],
      ["show", "skip faces"],
    ];
    for (const donts of samples) {
      const sms = voiceRecapSms(["warm"], donts);
      expect(sms, sms).not.toMatch(STAY_CLEAR_BAD);
      for (const raw of donts) {
        expect(formatDontForRecap(raw), raw).not.toMatch(STAY_CLEAR_BAD);
      }
    }
  });
});
