import { describe, it, expect } from "vitest";
import { alreadyRefreshedThisWeek } from "../creativeRefresh.js";
import { aiSpendWeekKey } from "../aiSpend.js";
import type { Brand } from "@pulse/shared";

function fakeBrand(facts: Brand["facts"]): Pick<Brand, "facts" | "status"> {
  return { facts, status: "active" };
}

describe("alreadyRefreshedThisWeek", () => {
  it("is false when never refreshed", () => {
    expect(alreadyRefreshedThisWeek(fakeBrand({}) as Brand)).toBe(false);
  });

  it("is true when week_key matches current ISO week", () => {
    const week = aiSpendWeekKey();
    expect(
      alreadyRefreshedThisWeek(
        fakeBrand({ creative_refresh: { week_key: week, last_at: new Date().toISOString() } }) as Brand,
      ),
    ).toBe(true);
  });

  it("is false when week_key is stale", () => {
    expect(
      alreadyRefreshedThisWeek(
        fakeBrand({ creative_refresh: { week_key: "1999-W01", last_at: "1999-01-01" } }) as Brand,
      ),
    ).toBe(false);
  });
});
