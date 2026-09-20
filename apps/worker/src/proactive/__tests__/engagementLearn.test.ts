import { describe, it, expect, vi } from "vitest";
import type { Brand } from "@pulse/shared";
import { runEngagementLearn, engagementLearnMode, type EngagementLearnDeps } from "../engagementLearn.js";

function brand(id: string): Brand {
  return { id, facts: {} } as unknown as Brand;
}

function makeDeps(over: Partial<EngagementLearnDeps> & { brands: Brand[] }): {
  deps: EngagementLearnDeps;
  applied: Array<{ id: string; apply: boolean }>;
} {
  const applied: Array<{ id: string; apply: boolean }> = [];
  const deps: EngagementLearnDeps = {
    listActiveBrands: async () => over.brands,
    learn: over.learn ?? (async (b, apply) => {
      applied.push({ id: b.id, apply });
      return { dialChange: null, reason: "no dial change" };
    }),
    mode: over.mode ?? "log",
    now: () => new Date("2026-09-19T12:00:00.000Z"),
  };
  return { deps, applied };
}

describe("engagementLearnMode", () => {
  it("maps the env flag, defaulting to off", () => {
    expect(engagementLearnMode({} as NodeJS.ProcessEnv)).toBe("off");
    expect(engagementLearnMode({ KIP_ENGAGEMENT_LEARN: "LOG" } as unknown as NodeJS.ProcessEnv)).toBe("log");
    expect(engagementLearnMode({ KIP_ENGAGEMENT_LEARN: "on" } as unknown as NodeJS.ProcessEnv)).toBe("on");
    expect(engagementLearnMode({ KIP_ENGAGEMENT_LEARN: "true" } as unknown as NodeJS.ProcessEnv)).toBe("off");
  });
});

describe("runEngagementLearn", () => {
  it("does nothing when mode is off", async () => {
    const { deps, applied } = makeDeps({ brands: [brand("b1")], mode: "off" });
    await runEngagementLearn(deps);
    expect(applied).toHaveLength(0);
  });

  it("log mode learns with apply=false for every brand", async () => {
    const { deps, applied } = makeDeps({ brands: [brand("b1"), brand("b2")], mode: "log" });
    await runEngagementLearn(deps);
    expect(applied).toEqual([
      { id: "b1", apply: false },
      { id: "b2", apply: false },
    ]);
  });

  it("on mode learns with apply=true", async () => {
    const { deps, applied } = makeDeps({ brands: [brand("b1")], mode: "on" });
    await runEngagementLearn(deps);
    expect(applied).toEqual([{ id: "b1", apply: true }]);
  });

  it("one brand's failure doesn't stop the next", async () => {
    const seen: string[] = [];
    const { deps } = makeDeps({
      brands: [brand("b1"), brand("b2")],
      mode: "on",
      learn: async (b) => {
        seen.push(b.id);
        if (b.id === "b1") throw new Error("db blip");
        return { dialChange: "balanced", reason: "quiet -> balanced" };
      },
    });
    await runEngagementLearn(deps);
    expect(seen).toEqual(["b1", "b2"]);
  });
});
