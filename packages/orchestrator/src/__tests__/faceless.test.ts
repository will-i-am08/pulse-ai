import { describe, it, expect } from "vitest";
import {
  isFacelessBrand,
  isNamelessCreative,
  overlayMasthead,
  stripPersonalNames,
  facelessPromptLine,
} from "../faceless.js";
import { looksLikeGapFillDraftAsk } from "../draftAsk.js";
import { looksLikeKickoffRequest } from "../kickoffs.js";

type MiniBrand = {
  name: string;
  facts: { faceless?: boolean; nameless?: boolean; owner_name?: string };
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
