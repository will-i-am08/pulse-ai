import { describe, expect, it } from "vitest";
import { resolveModelPlan, type ModelPlanEnv } from "../llm.js";

const baseEnv: ModelPlanEnv = {
  DRAFT_MODEL: "claude-haiku-test",
  FALLBACK_MODEL: "claude-sonnet-test",
  SMART_MODEL: undefined,
  KIP_SMART_ROUTING: false,
};

describe("resolveModelPlan", () => {
  it("routing off → always standard plan (DRAFT then FALLBACK), ignoring tier", () => {
    for (const tier of ["fast", "standard", "smart"] as const) {
      expect(resolveModelPlan(tier, baseEnv)).toEqual([
        { model: "claude-haiku-test", retries: 2 },
        { model: "claude-sonnet-test", retries: 1 },
      ]);
    }
    expect(resolveModelPlan(undefined, baseEnv)).toEqual([
      { model: "claude-haiku-test", retries: 2 },
      { model: "claude-sonnet-test", retries: 1 },
    ]);
  });

  it("routing on + standard → DRAFT retries then FALLBACK once", () => {
    const env = { ...baseEnv, KIP_SMART_ROUTING: true };
    expect(resolveModelPlan("standard", env)).toEqual([
      { model: "claude-haiku-test", retries: 2 },
      { model: "claude-sonnet-test", retries: 1 },
    ]);
    expect(resolveModelPlan(undefined, env)).toEqual([
      { model: "claude-haiku-test", retries: 2 },
      { model: "claude-sonnet-test", retries: 1 },
    ]);
  });

  it("routing on + fast → DRAFT only (no Sonnet fallback)", () => {
    const env = { ...baseEnv, KIP_SMART_ROUTING: true };
    expect(resolveModelPlan("fast", env)).toEqual([
      { model: "claude-haiku-test", retries: 2 },
    ]);
  });

  it("routing on + smart → SMART/FALLBACK first, then DRAFT once", () => {
    const env = { ...baseEnv, KIP_SMART_ROUTING: true };
    expect(resolveModelPlan("smart", env)).toEqual([
      { model: "claude-sonnet-test", retries: 2 },
      { model: "claude-haiku-test", retries: 1 },
    ]);
  });

  it("routing on + smart uses SMART_MODEL when set", () => {
    const env: ModelPlanEnv = {
      ...baseEnv,
      KIP_SMART_ROUTING: true,
      SMART_MODEL: "claude-opus-test",
    };
    expect(resolveModelPlan("smart", env)).toEqual([
      { model: "claude-opus-test", retries: 2 },
      { model: "claude-haiku-test", retries: 1 },
    ]);
  });
});
