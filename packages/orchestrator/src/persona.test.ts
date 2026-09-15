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
});

describe("connectionSummary", () => {
  it("does not claim Instagram or Facebook when tokens are missing", () => {
    const brand = { name: "Lab Cafe", facts: { lab: true } } as unknown as Brand;
    const text = connectionSummary(brand);
    expect(text).toMatch(/aren't connected yet/i);
    expect(text).not.toMatch(/Publishing:/);
  });
});
