import { describe, it, expect } from "vitest";
import { planFromOwnerText, planFromKickoffPayload } from "../creativePlan.js";

describe("planFromOwnerText", () => {
  it("maps carousel + business ideas → photo_carousel + ideaMode + premium", () => {
    const plan = planFromOwnerText(
      "make a carousel of AI business ideas with cinematic car photos",
    );
    expect(plan.ideaMode).toBe(true);
    expect(plan.preferCarousel).toBe(true);
    expect(plan.visuals).toBe("photo");
    expect(plan.surface).toBe("photo_carousel");
    expect(plan.quality).toBe("premium");
    expect(plan.topicHint).toMatch(/business ideas/i);
  });

  it("maps designed text cards → designed_feed (or carousel when asked)", () => {
    const feed = planFromOwnerText("make designed text cards for today's tip");
    expect(feed.visuals).toBe("designed");
    expect(feed.preferCarousel).toBe(false);
    expect(feed.surface).toBe("designed_feed");

    const car = planFromOwnerText("designed slides carousel of tips");
    expect(car.visuals).toBe("designed");
    expect(car.preferCarousel).toBe(true);
    expect(car.surface).toBe("designed_carousel");
  });

  it("honours not-a-carousel / square graphic as feed", () => {
    const plan = planFromOwnerText(
      "Make one square graphic (not a carousel) with this exact overlay headline burned on the image: WHAT FOUNDER OPS ACTUALLY DOES",
    );
    expect(plan.preferCarousel).toBe(false);
    expect(plan.surface).toBe("photo_feed");
  });

  it("honours premium and draft quality keywords", () => {
    expect(planFromOwnerText("luxury editorial feed post").quality).toBe("premium");
    expect(planFromOwnerText("quick rough draft of a post").quality).toBe("draft");
    expect(planFromOwnerText("make a normal post please").quality).toBe("standard");
  });

  it("empty text → photo_feed standard", () => {
    const plan = planFromOwnerText("");
    expect(plan.surface).toBe("photo_feed");
    expect(plan.visuals).toBe("photo");
    expect(plan.quality).toBe("standard");
    expect(plan.ideaMode).toBe(false);
    expect(plan.preferCarousel).toBe(false);
    expect(plan.topicHint).toBeNull();
  });

  it("treats swipe / multi-photo as carousel asks", () => {
    expect(planFromOwnerText("swipeable tips with photos").preferCarousel).toBe(true);
    expect(planFromOwnerText("multi-photo story dump").preferCarousel).toBe(true);
  });
});

describe("planFromKickoffPayload", () => {
  const brand = { visual: {} };

  it("honours payload visuals / preferCarousel / quality", () => {
    const plan = planFromKickoffPayload(
      {
        topicHint: "some tip post",
        visuals: "designed",
        preferCarousel: true,
        quality: "draft",
      },
      brand,
    );
    expect(plan.visuals).toBe("designed");
    expect(plan.preferCarousel).toBe(true);
    expect(plan.surface).toBe("designed_carousel");
    expect(plan.quality).toBe("draft");
    expect(plan.topicHint).toBe("some tip post");
  });

  it("falls back to owner-text planning when payload fields missing", () => {
    const plan = planFromKickoffPayload(
      { hint: "carousel of business ideas please" },
      brand,
    );
    expect(plan.ideaMode).toBe(true);
    expect(plan.surface).toBe("photo_carousel");
    expect(plan.quality).toBe("premium");
  });
});
