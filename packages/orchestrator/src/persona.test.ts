import { describe, expect, it } from "vitest";
import { firstNameFromDisplayName, ownerFirstName, personaLines, personaVoiceLines, connectionSummary } from "./persona.js";
import type { Brand } from "@pulse/shared";

function brandWithFacts(facts: Record<string, unknown> | null): Brand {
  return { facts } as unknown as Brand;
}

describe("firstNameFromDisplayName", () => {
  it("returns the first token", () => {
    expect(firstNameFromDisplayName("William Smith")).toBe("William");
  });

  it("trims whitespace", () => {
    expect(firstNameFromDisplayName("  Alex  ")).toBe("Alex");
  });

  it("returns null for empty values", () => {
    expect(firstNameFromDisplayName("")).toBeNull();
    expect(firstNameFromDisplayName("   ")).toBeNull();
    expect(firstNameFromDisplayName(null)).toBeNull();
    expect(firstNameFromDisplayName(undefined)).toBeNull();
  });
});

describe("ownerFirstName", () => {
  it("reads facts.owner_name", () => {
    expect(ownerFirstName(brandWithFacts({ owner_name: "William" }))).toBe("William");
  });

  it("returns null when missing", () => {
    expect(ownerFirstName(brandWithFacts({}))).toBeNull();
    expect(ownerFirstName(brandWithFacts(null))).toBeNull();
  });
});

describe("personaVoiceLines", () => {
  it("allows a weekday rundown and leaves photo/font rules to personaLines", () => {
    const brand = { name: "Sunrise Cafe", facts: { owner_name: "Sam" } } as unknown as Brand;
    const voice = personaVoiceLines(brand).join("\n");
    const full = personaLines(brand).join("\n");
    expect(voice).toMatch(/rundown of days/i);
    expect(voice).not.toMatch(/Creative default/i);
    expect(voice).not.toMatch(/upload photos/i);
    expect(full).toMatch(/Creative default/i);
    expect(full).toMatch(/upload photos/i);
  });

  it("does not treat a lab placeholder name as the real business", () => {
    const brand = { name: "Lab Cafe", facts: { lab: true } } as unknown as Brand;
    const voice = personaVoiceLines(brand).join("\n");
    expect(voice).toMatch(/Never invent Lab Cafe|never invent Lab Cafe|Never mention the dashboard account name/i);
    expect(voice).not.toMatch(/You are Kip — "Lab Cafe"'s social media manager/);
    expect(voice).not.toMatch(/First question: what do they actually do/i);
    expect(voice).toMatch(/scout_ideas|do not interview/i);
  });

  it("uses lab differentiators when on file", () => {
    const brand = {
      name: "Lab Cafe",
      facts: { lab: true, differentiators: "emergency plumber" },
    } as unknown as Brand;
    const voice = personaVoiceLines(brand).join("\n");
    expect(voice).toMatch(/emergency plumber/);
    expect(voice).not.toMatch(/First question/i);
  });
});

describe("connectionSummary", () => {
  it("does not claim Instagram or Facebook when tokens are missing", () => {
    const brand = { name: "Lab Cafe", facts: { lab: true } } as unknown as Brand;
    const text = connectionSummary(brand);
    expect(text).toMatch(/aren't connected yet/i);
    expect(text).not.toMatch(/Publishing:/);
  });
});
