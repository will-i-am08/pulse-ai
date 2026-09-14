import { describe, it, expect } from "vitest";
import { wantsResearchedIdeaSlides } from "../formats.js";

describe("wantsResearchedIdeaSlides", () => {
  it("detects business / AI idea briefs", () => {
    expect(
      wantsResearchedIdeaSlides(
        "Can you make me a carousel with cinematic car photos with text over the top with some business ideas",
      ),
    ).toBe(true);
    expect(wantsResearchedIdeaSlides("AI business ideas one per slide")).toBe(true);
    expect(wantsResearchedIdeaSlides("research into them and put one idea per photo")).toBe(true);
  });

  it("ignores plain carousel / photo asks", () => {
    expect(
      wantsResearchedIdeaSlides(
        "Can you make me a carousel with cinematic car photos with text over the top?",
      ),
    ).toBe(false);
    expect(wantsResearchedIdeaSlides("draft a tip carousel")).toBe(false);
    expect(wantsResearchedIdeaSlides("")).toBe(false);
  });
});
