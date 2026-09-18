import { describe, it, expect } from "vitest";
import {
  looksLikeComparisonBrief,
  looksLikeCityscapeBrief,
  looksLikeSingularPostBrief,
  heuristicBriefCompliance,
  reinforceTopicHint,
  interpretComplianceLlm,
} from "../briefCompliance.js";
import { inferKickoffFromUserMessage } from "../kickoffs.js";
import { planFromOwnerText } from "../creativePlan.js";

const BRIEF =
  "Could you do up a post comparing ai coding tools with a city scape as the background";

describe("brief intent helpers", () => {
  it("detects comparison + cityscape + singular post", () => {
    expect(looksLikeComparisonBrief(BRIEF)).toBe(true);
    expect(looksLikeCityscapeBrief(BRIEF)).toBe(true);
    expect(looksLikeSingularPostBrief(BRIEF)).toBe(true);
    expect(looksLikeSingularPostBrief("make me a carousel about cars")).toBe(false);
  });
});

describe("kickoff + creative plan default to feed for a post ask", () => {
  it("defaults Bill's ask to one photo feed draft (carousel still allowed if chosen)", () => {
    const kick = inferKickoffFromUserMessage(BRIEF);
    expect(kick?.kind).toBe("draft_posts");
    expect(kick?.payload.count).toBe(1);
    expect(kick?.payload.preferCarousel).toBe(false);
    expect(kick?.payload.topicHint).toBe(BRIEF.slice(0, 280));

    const plan = planFromOwnerText(BRIEF);
    expect(plan.preferCarousel).toBe(false);
    expect(plan.surface).toBe("photo_feed");
  });
});

describe("heuristicBriefCompliance", () => {
  it("fails vague AI tips that never compare named tools", () => {
    const r = heuristicBriefCompliance({
      brief: BRIEF,
      caption: "AI coding tools aren't interchangeable. Pick the right one for the job.",
      overlays: ["Pick smarter"],
      photoPrompts: ["Cinematic city skyline at dusk"],
      surface: "feed",
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/comparison/i);
    expect(r.reinforceHint).toMatch(/COMPARE/i);
  });

  it("passes a real named-tool comparison with cityscape prompt", () => {
    const r = heuristicBriefCompliance({
      brief: BRIEF,
      caption:
        "Cursor ships faster. Claude Code thinks deeper. Use Cursor to scaffold, Claude to review.",
      overlays: ["Cursor vs Claude Code"],
      photoPrompts: ["Cinematic cityscape skyline at night, wet streets, bokeh lights"],
      surface: "feed",
    });
    expect(r.pass).toBe(true);
  });

  it("allows carousel surface when content still hits the brief (a post may be a carousel)", () => {
    const r = heuristicBriefCompliance({
      brief: BRIEF,
      caption: "Cursor vs Copilot: Cursor edits the repo, Copilot completes the line.",
      overlays: ["Cursor vs Copilot"],
      photoPrompts: ["City skyline dusk"],
      surface: "carousel",
    });
    expect(r.pass).toBe(true);
  });

  it("reinforceTopicHint appends compliance fix once", () => {
    const next = reinforceTopicHint(BRIEF, "MUST compare two named tools");
    expect(next).toMatch(/COMPLIANCE FIX/);
    expect(next).toMatch(/named tools/);
  });
});

describe("interpretComplianceLlm", () => {
  it("treats pass:true with praise reasons as a pass", () => {
    const r = interpretComplianceLlm({
      pass: true,
      reasons: [
        "Caption nails the dry, genuine tone",
        "Photo prompt specifies a real cafe shot, not stock",
      ],
      reinforce_hint: "",
    });
    expect(r.pass).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it("treats pass:false with fail notes as a miss", () => {
    const r = interpretComplianceLlm({
      pass: false,
      reasons: ["never named the two tools"],
      reinforce_hint: "Name Cursor vs Claude with a concrete difference",
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/two tools/);
    expect(r.reinforceHint).toMatch(/Cursor/);
  });
});
