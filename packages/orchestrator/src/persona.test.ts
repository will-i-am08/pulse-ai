import { describe, expect, it } from "vitest";
import { firstNameFromDisplayName, ownerFirstName } from "./persona.js";
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
