import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isPersonalAccount,
  personalAdsRefuseSms,
  personalIcpRefuseSms,
  personalStrategySkipSms,
} from "../accountMode.js";
import {
  estimateCost,
  formatCostUsd,
  costEstimateSmsLine,
  weeklyAiSpendCapUsd,
  resetServerEnvCache,
} from "../costEstimate.js";
import { assertAiSpendAllowed, aiSpendWeekKey } from "../aiSpend.js";
import type { Brand } from "@pulse/shared";

describe("personal account mode", () => {
  it("detects personal vs business", () => {
    expect(isPersonalAccount({ account_type: "personal" })).toBe(true);
    expect(isPersonalAccount({ account_type: "business" })).toBe(false);
    expect(isPersonalAccount({ account_type: null })).toBe(false);
    expect(isPersonalAccount(undefined)).toBe(false);
  });

  it("refuses ads with a clear SMS", () => {
    const sms = personalAdsRefuseSms();
    expect(sms.toLowerCase()).toContain("personal");
    expect(sms.toLowerCase()).toMatch(/ads/);
  });

  it("skips ICP / strategy with a clear SMS", () => {
    expect(personalIcpRefuseSms().toLowerCase()).toMatch(/icp|personal/);
    expect(personalStrategySkipSms().toLowerCase()).toMatch(/personal|icp|niche/);
  });
});

describe("estimateCost helper", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    resetServerEnvCache();
    delete process.env.COST_IMAGE_USD;
    delete process.env.COST_VIDEO_USD;
    delete process.env.COST_SPECIALTY_USD;
    delete process.env.AI_WEEKLY_SPEND_CAP_USD;
  });

  afterEach(() => {
    process.env = { ...prev };
    resetServerEnvCache();
  });

  it("returns defaults for image / video / specialty", () => {
    expect(estimateCost({ kind: "image" }).usd).toBe(0.04);
    expect(estimateCost({ kind: "video" }).usd).toBe(0.5);
    expect(estimateCost({ kind: "specialty" }).usd).toBe(0.12);
  });

  it("reads COST_*_USD from env", () => {
    process.env.COST_VIDEO_USD = "1.25";
    resetServerEnvCache();
    expect(estimateCost({ kind: "video" }).usd).toBe(1.25);
  });

  it("formats an SMS cost line", () => {
    expect(costEstimateSmsLine("video")).toMatch(/this may cost ~\$/);
    expect(formatCostUsd(0.5)).toBe("~$0.50");
  });

  it("hard-refuses when weekly AI spend cap would be exceeded", () => {
    process.env.AI_WEEKLY_SPEND_CAP_USD = "1";
    process.env.COST_VIDEO_USD = "0.5";
    resetServerEnvCache();
    const brand = {
      facts: { ai_spend: { week_key: aiSpendWeekKey(), spent_usd: 0.8 } },
    } as Pick<Brand, "facts">;
    const msg = assertAiSpendAllowed(brand, "video");
    expect(msg).toBeTruthy();
    expect(msg!.toLowerCase()).toMatch(/cap|week/);
  });

  it("allows spend under the weekly cap", () => {
    process.env.AI_WEEKLY_SPEND_CAP_USD = "10";
    process.env.COST_VIDEO_USD = "0.5";
    resetServerEnvCache();
    expect(weeklyAiSpendCapUsd()).toBe(10);
    const brand = {
      facts: { ai_spend: { week_key: aiSpendWeekKey(), spent_usd: 1 } },
    } as Pick<Brand, "facts">;
    expect(assertAiSpendAllowed(brand, "video")).toBeNull();
  });
});
