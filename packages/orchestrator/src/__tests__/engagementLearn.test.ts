import { describe, it, expect } from "vitest";
import type { EngagementProfile } from "@pulse/shared";
import {
  computeChannelSignals,
  updateAffinity,
  decideDialChange,
  planEngagementLearn,
  type ProactiveSendRow,
} from "../engagementLearn.js";

const NOW = new Date("2026-09-19T12:00:00.000Z");
const H = 60 * 60 * 1000;

function profile(over: Partial<EngagementProfile> = {}): EngagementProfile {
  return {
    proactivity: "balanced",
    warmth: "friendly",
    report: { cadence: "weekly", hour_local: 8 },
    affinity: {},
    source: "default",
    updated_at: "",
    ...over,
  };
}

function sentHoursAgo(channel: string, hours: number): ProactiveSendRow {
  return { channel, sent_at: new Date(NOW.getTime() - hours * H).toISOString() };
}

describe("computeChannelSignals", () => {
  it("scores +1 when a reply lands within the window", () => {
    const sends = [sentHoursAgo("checkin", 72)];
    const reply = [NOW.getTime() - 60 * H]; // 12h after the send
    expect(computeChannelSignals(sends, reply, NOW)).toEqual({ checkin: 1 });
  });

  it("scores -1 when no reply follows a judgeable send", () => {
    const sends = [sentHoursAgo("checkin", 72)];
    expect(computeChannelSignals(sends, [], NOW)).toEqual({ checkin: -1 });
  });

  it("ignores sends too fresh to judge (< 48h)", () => {
    expect(computeChannelSignals([sentHoursAgo("checkin", 10)], [], NOW)).toEqual({});
  });

  it("does not credit a reply that came before the send", () => {
    const sends = [sentHoursAgo("checkin", 72)];
    const earlier = [NOW.getTime() - 100 * H];
    expect(computeChannelSignals(sends, earlier, NOW)).toEqual({ checkin: -1 });
  });

  it("averages multiple sends per channel", () => {
    const sends = [sentHoursAgo("report", 72), sentHoursAgo("report", 96)];
    const oneReply = [NOW.getTime() - 60 * H]; // replies to the 72h send only
    expect(computeChannelSignals(sends, oneReply, NOW).report).toBe(0); // (+1 + -1)/2
  });
});

describe("updateAffinity", () => {
  it("EMAs new signal onto prior (0.7 old + 0.3 new)", () => {
    expect(updateAffinity({ checkin: 0 }, { checkin: 1 }).checkin).toBeCloseTo(0.3, 5);
    expect(updateAffinity({ checkin: 0.3 }, { checkin: -1 }).checkin).toBeCloseTo(0.7 * 0.3 - 0.3, 5);
  });
  it("treats a missing prior as 0 and leaves untouched channels alone", () => {
    const out = updateAffinity({ report: 0.5 }, { checkin: 1 });
    expect(out.checkin).toBeCloseTo(0.3, 5);
    expect(out.report).toBe(0.5);
  });
  it("clamps to [-1, 1]", () => {
    expect(updateAffinity({ x: 1 }, { x: 1 }).x).toBeLessThanOrEqual(1);
  });
});

describe("decideDialChange", () => {
  it("never touches an owner-set profile", () => {
    const p = profile({ source: "owner_set", proactivity: "high" });
    expect(decideDialChange(p, { checkin: -1, report: -1, autonomy: -1 })).toBeNull();
  });

  it("steps DOWN one notch when >=2 channels are disliked", () => {
    expect(decideDialChange(profile({ proactivity: "high" }), { checkin: -0.5, report: -0.4 })).toBe("balanced");
    expect(decideDialChange(profile({ proactivity: "balanced" }), { checkin: -0.5, report: -0.4 })).toBe("quiet");
  });

  it("does NOT step down on a single disliked channel", () => {
    expect(decideDialChange(profile({ proactivity: "balanced" }), { checkin: -0.9 })).toBeNull();
  });

  it("stops at quiet (no step below the floor)", () => {
    expect(decideDialChange(profile({ proactivity: "quiet" }), { checkin: -0.9, report: -0.9 })).toBeNull();
  });

  it("steps UP from quiet to balanced on real enthusiasm", () => {
    expect(decideDialChange(profile({ proactivity: "quiet" }), { checkin: 0.6, report: 0.5 })).toBe("balanced");
  });

  it("NEVER escalates to high — caps at balanced", () => {
    expect(decideDialChange(profile({ proactivity: "balanced" }), { checkin: 0.9, report: 0.9 })).toBeNull();
  });

  it("returns null with no affinity data", () => {
    expect(decideDialChange(profile(), {})).toBeNull();
  });
});

describe("planEngagementLearn", () => {
  it("moves at most one step and reports it", () => {
    const sends = [sentHoursAgo("checkin", 72), sentHoursAgo("report", 72)];
    // No replies at all → both channels -1 signal, but from 0 prior EMA gives -0.3
    // each, which is NOT below the -0.3 threshold (strict <), so no step yet.
    const plan = planEngagementLearn(profile({ proactivity: "balanced" }), sends, [], NOW);
    expect(plan.nextAffinity.checkin).toBeCloseTo(-0.3, 5);
    expect(plan.dialChange).toBeNull();
  });

  it("steps down once sustained dislike pushes two channels past the threshold", () => {
    const sends = [sentHoursAgo("checkin", 72), sentHoursAgo("report", 72)];
    const prior = profile({ proactivity: "high", affinity: { checkin: -0.5, report: -0.5 } });
    const plan = planEngagementLearn(prior, sends, [], NOW);
    expect(plan.nextAffinity.checkin).toBeLessThan(-0.3);
    expect(plan.dialChange).toBe("balanced");
    expect(plan.reason).toContain("high -> balanced");
  });
});
