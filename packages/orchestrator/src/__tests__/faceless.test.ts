import { describe, it, expect } from "vitest";
import {
  isFacelessBrand,
  isNamelessCreative,
  looksLikePersonalBrandName,
  overlayMasthead,
  stripPersonalNames,
  facelessPromptLine,
  facelessPhotoConstraint,
} from "../faceless.js";
import { looksLikeGapFillDraftAsk } from "../draftAsk.js";
import { inferKickoffFromUserMessage, looksLikeKickoffRequest } from "../kickoffs.js";

type MiniBrand = {
  name: string;
  facts: {
    faceless?: boolean;
    nameless?: boolean;
    owner_name?: string;
    business_name?: string;
  };
  onboarding_state: {
    status?: string;
    transcript?: Array<{ role?: string; content?: string; body?: string }>;
    answers?: Record<string, string>;
  };
};

function mini(partial: {
  name: string;
  facts?: MiniBrand["facts"];
  onboarding_state?: MiniBrand["onboarding_state"];
}): MiniBrand {
  return {
    name: partial.name,
    facts: partial.facts ?? {},
    onboarding_state: partial.onboarding_state ?? { status: "done" },
  };
}

describe("faceless / nameless creatives", () => {
  it("treats facts.faceless as nameless (no masthead stamp)", () => {
    const b = mini({ name: "Bill Calder", facts: { faceless: true, owner_name: "Bill" } });
    expect(isFacelessBrand(b)).toBe(true);
    expect(isNamelessCreative(b)).toBe(true);
    expect(overlayMasthead(b)).toBe("");
    expect(facelessPromptLine(b)).toMatch(/FACELESS/i);
  });

  it("picks up faceless from onboarding transcript when facts flag missing", () => {
    const b = mini({
      name: "Bill Calder",
      facts: { owner_name: "Bill" },
      onboarding_state: {
        status: "done",
        transcript: [{ role: "user", content: "I want to stay faceless" }],
      },
    });
    expect(isFacelessBrand(b)).toBe(true);
    expect(overlayMasthead(b)).toBe("");
  });

  it("strips personal name tokens from overlay copy", () => {
    const b = mini({ name: "Bill Calder", facts: { faceless: true, owner_name: "Bill" } });
    expect(stripPersonalNames("Bill says start today", b).toLowerCase()).not.toContain("bill");
    expect(stripPersonalNames("CALDER METHOD", b).toLowerCase()).not.toContain("calder");
  });

  it("still stamps named brands", () => {
    const b = mini({ name: "Acme Dental", facts: { faceless: false } });
    expect(isNamelessCreative(b)).toBe(false);
    expect(overlayMasthead(b)).toBe("ACME DENTAL");
  });

  it("faceless café keeps the business name on the masthead (not a random personal stamp)", () => {
    const b = mini({
      name: "Sunrise Cafe",
      facts: { faceless: true, business_name: "Sunrise Cafe" },
    });
    expect(isFacelessBrand(b)).toBe(true);
    expect(looksLikePersonalBrandName(b)).toBe(false);
    expect(isNamelessCreative(b)).toBe(false);
    expect(overlayMasthead(b)).toBe("SUNRISE CAFE");
    expect(facelessPhotoConstraint(b)).toMatch(/no faces/i);
  });

  it("does not randomly stamp a personal name just because the account is named after a person", () => {
    const b = mini({ name: "Bill Calder", facts: { faceless: true, owner_name: "Bill Calder" } });
    expect(looksLikePersonalBrandName(b)).toBe(true);
    expect(overlayMasthead(b)).toBe("");
    expect(facelessPhotoConstraint(b)).toMatch(/no people/i);
  });

  it("honors nameless===false override on a faceless brand", () => {
    const b = mini({ name: "Bill Calder", facts: { faceless: true, nameless: false } });
    expect(isFacelessBrand(b)).toBe(true);
    expect(isNamelessCreative(b)).toBe(false);
    expect(overlayMasthead(b)).toBe("BILL CALDER");
  });
});

describe("gap-fill draft ask vs carousel kickoff", () => {
  it("matches draft-one gap fills", () => {
    expect(looksLikeGapFillDraftAsk("draft one")).toBe(true);
    expect(looksLikeGapFillDraftAsk("can you write something")).toBe(true);
    expect(looksLikeGapFillDraftAsk("make a post")).toBe(true);
  });

  it("does not steal carousel/photo kickoffs into the filler path", () => {
    const carousel =
      "Can you make me a carrousel with cinematic business photos with text over the top?";
    expect(looksLikeKickoffRequest(carousel)).toBe(true);
    expect(looksLikeGapFillDraftAsk(carousel)).toBe(false);
    expect(looksLikeGapFillDraftAsk("Generate the photos")).toBe(false);
  });
});
