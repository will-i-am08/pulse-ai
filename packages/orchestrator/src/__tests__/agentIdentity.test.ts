import { describe, expect, it } from "vitest";
import type { Brand } from "@pulse/shared";
import {
  RETRIEVED_PACK_HEADING,
  agentIdentity,
  listsToolMenu,
} from "../agentIdentity.js";

function stubBrand(over: Partial<Brand> = {}): Brand {
  return {
    id: "b1",
    name: "Sunrise Cafe",
    facts: { owner_name: "Sam" },
    ...over,
  } as Brand;
}

describe("listsToolMenu", () => {
  it("is true only for a capability list, not incidental schedule wording", () => {
    expect(
      listsToolMenu("you can schedule posts, pull analytics, and check calendar"),
    ).toBe(true);
    expect(listsToolMenu("Drafts wait. You may schedule once they approve.")).toBe(false);
  });
});

describe("agentIdentity", () => {
  it("names Kip as this brand's social media manager", () => {
    const prompt = agentIdentity(stubBrand(), undefined, new Date("2026-09-18T03:11:00.000Z"));
    expect(prompt).toMatch(/Kip/i);
    expect(prompt).toMatch(/social media manager/i);
    expect(prompt).toContain("Sunrise Cafe");
    expect(prompt).toMatch(/Local clock right now:.*Friday/i);
    expect(prompt).toMatch(/Australia\/Sydney/);
  });

  it("includes the owner first name when known", () => {
    const named = agentIdentity(stubBrand());
    expect(named).toMatch(/Sam/);
    const unnamed = agentIdentity(stubBrand({ facts: {} }));
    expect(unnamed).toMatch(/owner of Sunrise Cafe/);
    expect(unnamed).not.toMatch(/\bSam\b/);
  });

  it("never says owner of Lab Cafe for lab brands with empty niche", () => {
    const prompt = agentIdentity(
      stubBrand({ name: "Lab Cafe", facts: { lab: true, owner_name: "Sam" } }),
    );
    expect(prompt).not.toMatch(/owner of Lab Cafe/i);
    expect(prompt).toMatch(/owner of this business/i);
    expect(prompt).not.toMatch(/First question: what do they actually do/i);
    expect(prompt).toMatch(/never fish|do not quiz|skip the challenge/i);
  });

  it("uses lab differentiators in who-you-serve when present", () => {
    const prompt = agentIdentity(
      stubBrand({
        name: "Lab Cafe",
        facts: { lab: true, differentiators: "emergency plumber", owner_name: "Sam" },
      }),
    );
    expect(prompt).toMatch(/owner of emergency plumber/i);
    expect(prompt).not.toMatch(/owner of Lab Cafe/i);
  });

  it("requires draft_copy before SMS when the owner asked for content", () => {
    const prompt = agentIdentity(stubBrand());
    expect(prompt).toMatch(/tool-call draft_copy before/i);
    expect(prompt).toMatch(/draft_copy/);
    expect(prompt).toMatch(/set_image_text/);
    expect(prompt).toMatch(/scout_ideas/);
    expect(prompt).toMatch(/competitor watches|research snapshots|Ad Library/i);
    expect(prompt).toMatch(/soft challenge|push back once|what it does for their niche/i);
    expect(prompt).toMatch(/do not interview them first/i);
    expect(prompt).toMatch(/reel with no clip/i);
    expect(prompt).toMatch(/Brand recall:/i);
    expect(prompt).toMatch(/never\/don't content bans/i);
    expect(prompt).toMatch(/never scout_ideas for a draft ask/i);
    expect(prompt).toMatch(/exact overlay headline/i);
    expect(prompt).not.toMatch(/✨/);
  });

  it("covers escalation triggers without naming an operator in owner SMS", () => {
    const prompt = agentIdentity(stubBrand());
    expect(prompt).toMatch(/legal/i);
    expect(prompt).toMatch(/spend/i);
    expect(prompt).toMatch(/complaint/i);
    expect(prompt).toMatch(/escalate_to_human/);
    expect(prompt).toMatch(/never mention an (operator|agency)/i);
  });

  it("does not list tools as a capability menu", () => {
    const prompt = agentIdentity(stubBrand());
    expect(listsToolMenu(prompt)).toBe(false);
    expect(prompt.toLowerCase()).not.toContain("you can schedule");
    expect(prompt.toLowerCase()).not.toContain("pull analytics");
    expect(prompt.toLowerCase()).not.toContain("check calendar");
  });

  it("appends retrievedPack under the untrusted-data heading when provided", () => {
    const pack = "ICP: busy cafe owners. Offer: weekday lunch special.";
    const prompt = agentIdentity(stubBrand(), pack);
    expect(prompt).toContain(RETRIEVED_PACK_HEADING);
    expect(prompt).toContain(pack);
    expect(prompt.indexOf(RETRIEVED_PACK_HEADING)).toBeLessThan(prompt.indexOf(pack));
  });

  it("is still a valid identity prompt when the pack is omitted", () => {
    const prompt = agentIdentity(stubBrand());
    expect(prompt).toMatch(/Kip/i);
    expect(prompt).toMatch(/social media manager/i);
    expect(prompt).toMatch(/tool-call draft_copy before|draft_copy before/i);
    expect(prompt).not.toContain(RETRIEVED_PACK_HEADING);
    expect(listsToolMenu(prompt)).toBe(false);
  });

  it("ignores a blank retrievedPack", () => {
    const prompt = agentIdentity(stubBrand(), "   ");
    expect(prompt).not.toContain(RETRIEVED_PACK_HEADING);
  });

  it("uses voice craft without photo/font/strategy dumps", () => {
    const prompt = agentIdentity(stubBrand({ facts: { owner_name: "Sam", kip_preferences: [] } }));
    expect(prompt).toMatch(/weekday rundown|rundown of days/i);
    expect(prompt).not.toMatch(/Creative default/i);
    expect(prompt).not.toMatch(/\bType: pull fonts/i);
    expect(prompt).not.toMatch(/Brand strategy on file/i);
    expect(prompt).not.toMatch(/no lists, ever/i);
  });

  it("tells the agent to generate/source photos instead of stalling on upload vs source", () => {
    const prompt = agentIdentity(stubBrand());
    expect(prompt).toMatch(/never stall asking whether to upload vs source/i);
    expect(prompt).toMatch(/Photo default/i);
  });
});
