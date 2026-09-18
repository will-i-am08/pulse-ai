import { describe, expect, it } from "vitest";
import {
  formatGoingOutWhen,
  formatLocalClock,
  formatScheduledSlot,
  localClockPromptLine,
} from "../smsTime.js";

describe("formatGoingOutWhen", () => {
  const now = new Date("2026-09-18T03:11:00.000Z"); // Friday UTC / Friday afternoon Sydney

  it("says now for a past Thursday slot instead of announcing Thu", () => {
    // Live bug: approved an old Thu 1:21 pm slot on Friday → "going out Thu 1:21 pm".
    const pastThu = new Date("2026-09-17T13:21:00.000Z");
    expect(formatGoingOutWhen(pastThu, now)).toBe("now");
    expect(formatGoingOutWhen(pastThu.toISOString(), now)).toBe("now");
  });

  it("says now when the slot is due within a minute", () => {
    const due = new Date(now.getTime() + 30_000);
    expect(formatGoingOutWhen(due, now)).toBe("now");
  });

  it("keeps the weekday label for a future slot", () => {
    const later = new Date("2026-09-18T19:56:00.000Z");
    const out = formatGoingOutWhen(later, now);
    expect(out).toBe(formatScheduledSlot(later));
    expect(out.toLowerCase()).not.toBe("now");
    expect(out).toMatch(/pm/i);
  });

  it("falls back to soon for empty/invalid", () => {
    expect(formatGoingOutWhen(null, now)).toBe("soon");
    expect(formatGoingOutWhen("", now)).toBe("soon");
    expect(formatGoingOutWhen("not-a-date", now)).toBe("soon");
  });
});

describe("localClockPromptLine", () => {
  it("pins Friday in Sydney when UTC is still early Friday morning", () => {
    const fridayUtcMorning = new Date("2026-09-18T03:11:00.000Z");
    const line = localClockPromptLine(fridayUtcMorning, "Australia/Sydney");
    expect(line).toMatch(/Friday/i);
    expect(line).toMatch(/Australia\/Sydney/);
    expect(line).not.toMatch(/Thursday/i);
    expect(formatLocalClock(fridayUtcMorning, "Australia/Sydney")).toMatch(/Friday/i);
  });

  it("uses Friday Sydney when UTC is still Thursday evening", () => {
    // 2026-09-17 20:00 UTC = Friday 06:00 AEST — classic day-boundary trap.
    const thuUtc = new Date("2026-09-17T20:00:00.000Z");
    expect(formatLocalClock(thuUtc, "Australia/Sydney")).toMatch(/Friday/i);
    expect(localClockPromptLine(thuUtc, "Australia/Sydney")).toMatch(/Friday/i);
    // Process-local weekday may still say Thursday when TZ=UTC; the prompt must not.
    const utcWeekday = new Intl.DateTimeFormat("en-AU", {
      timeZone: "UTC",
      weekday: "long",
    }).format(thuUtc);
    expect(utcWeekday).toMatch(/Thursday/i);
  });
});
