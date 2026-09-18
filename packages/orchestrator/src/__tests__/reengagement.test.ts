import { describe, it, expect } from "vitest";
import { gapInfo } from "../reengagement.js";

// Brisbane is a fixed UTC+10 (no DST), so local hours/days are deterministic.
const TZ = "Australia/Brisbane";

describe("gapInfo time-aware ladder", () => {
  it("under 4h is seamless (no re-orient)", () => {
    const now = new Date("2026-06-15T08:00:00Z");
    const g = gapInfo(new Date("2026-06-15T05:30:00Z"), now, TZ); // 2.5h
    expect(g.bucket).toBe("seamless");
    expect(g.phrase).toBe("");
  });

  it("same day, morning → \"this morning\"", () => {
    const now = new Date("2026-06-15T08:00:00Z"); // 18:00 local, 15th
    const g = gapInfo(new Date("2026-06-14T22:00:00Z"), now, TZ); // 08:00 local, 15th (10h)
    expect(g.bucket).toBe("today");
    expect(g.phrase).toBe("this morning");
  });

  it("previous evening → \"last night\"", () => {
    const now = new Date("2026-06-15T08:00:00Z"); // 18:00 local, 15th
    const g = gapInfo(new Date("2026-06-14T09:00:00Z"), now, TZ); // 19:00 local, 14th
    expect(g.bucket).toBe("yesterday");
    expect(g.phrase).toBe("last night");
  });

  it("previous daytime → \"yesterday\"", () => {
    const now = new Date("2026-06-15T08:00:00Z"); // 18:00 local, 15th
    const g = gapInfo(new Date("2026-06-14T02:00:00Z"), now, TZ); // 12:00 local, 14th
    expect(g.bucket).toBe("yesterday");
    expect(g.phrase).toBe("yesterday");
  });

  it("a few days ago → \"the other day\"", () => {
    const now = new Date("2026-06-15T08:00:00Z");
    const g = gapInfo(new Date("2026-06-12T02:00:00Z"), now, TZ); // 3 local days
    expect(g.bucket).toBe("recent");
    expect(g.phrase).toBe("the other day");
  });

  it("over a week → \"it's been a while\"", () => {
    const now = new Date("2026-06-15T08:00:00Z");
    const g = gapInfo(new Date("2026-06-01T02:00:00Z"), now, TZ); // 14 local days
    expect(g.bucket).toBe("long");
    expect(g.phrase).toBe("it's been a while");
  });

  it("no prior message → treated as a long gap", () => {
    const g = gapInfo(null, new Date("2026-06-15T08:00:00Z"), TZ);
    expect(g.bucket).toBe("long");
    expect(g.phrase).toBe("it's been a while");
  });

  it("does not throw when process.env.TZ is Vercel junk :UTC (live glitch root cause)", () => {
    const prev = process.env.TZ;
    const prevPulse = process.env.PULSE_APP_TZ;
    try {
      process.env.TZ = ":UTC";
      delete process.env.PULSE_APP_TZ;
      const now = new Date("2026-09-18T03:00:00Z");
      const last = new Date("2026-09-17T20:00:00Z"); // >4h gap → uses Intl timeZone
      expect(() => gapInfo(last, now)).not.toThrow();
      const g = gapInfo(last, now);
      expect(g.bucket).not.toBe("seamless");
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
      if (prevPulse === undefined) delete process.env.PULSE_APP_TZ;
      else process.env.PULSE_APP_TZ = prevPulse;
    }
  });
});
