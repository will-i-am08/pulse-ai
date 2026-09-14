import { describe, it, expect } from "vitest";
import {
  heuristicDesignQa,
  designQaSampleIndices,
  designQaFailureSms,
  looksLikeCreativeRedoAsk,
  type DesignQaFixHints,
} from "../designQa.js";
import type { Brand } from "@pulse/shared";

const brand = {
  id: "b1",
  name: "Test Cafe",
  visual: { colors: ["#111", "#eee"], fonts: ["Inter"], aesthetic: "warm" },
} as unknown as Brand;

describe("photo_overlay Design QA", () => {
  it("heuristic fails empty / overlong overlay copy", () => {
    expect(
      heuristicDesignQa({ brand, slideTexts: ["ok", ""], mode: "photo_overlay" }).pass,
    ).toBe(false);
    expect(
      heuristicDesignQa({
        brand,
        slideTexts: ["x".repeat(200)],
        mode: "photo_overlay",
      }).pass,
    ).toBe(false);
    expect(
      heuristicDesignQa({ brand, slideTexts: ["Short tip"], mode: "photo_overlay" }).pass,
    ).toBe(true);
  });

  it("uses tighter overflow budget than designed cards", () => {
    const mid = "y".repeat(130);
    expect(
      heuristicDesignQa({ brand, slideTexts: [mid], mode: "photo_overlay" }).pass,
    ).toBe(false);
    expect(
      heuristicDesignQa({ brand, slideTexts: [mid], mode: "designed" }).pass,
    ).toBe(true);
  });

  it("sets shortenOverlay fixHints on overflow", () => {
    const qa = heuristicDesignQa({
      brand,
      slideTexts: ["z".repeat(200)],
      mode: "photo_overlay",
    });
    expect(qa.pass).toBe(false);
    expect(qa.fixHints?.shortenOverlay).toBe(true);
  });

  it("samples cover + mid when ≥3 slides", () => {
    expect(designQaSampleIndices(1)).toEqual([0]);
    expect(designQaSampleIndices(2)).toEqual([0]);
    expect(designQaSampleIndices(5)).toEqual([0, 2]);
  });

  it("failure SMS names the brand", () => {
    expect(designQaFailureSms("Test Cafe")).toMatch(/Test Cafe/);
    expect(designQaFailureSms("Test Cafe")).toMatch(/design check/i);
    expect(designQaFailureSms("Test Cafe")).toMatch(/regenerat/i);
  });

  it("DesignQaFixHints shape supports recompose signals", () => {
    const hints: DesignQaFixHints = {
      shortenOverlay: true,
      strongerPhoto: true,
      reason: "clipped overlay",
    };
    expect(hints.shortenOverlay).toBe(true);
    expect(hints.strongerPhoto).toBe(true);
  });
});


describe("looksLikeCreativeRedoAsk", () => {
  it("detects try something different / redo / new photos", () => {
    expect(looksLikeCreativeRedoAsk("Yeah try something different")).toBe(true);
    expect(looksLikeCreativeRedoAsk("redo it")).toBe(true);
    expect(looksLikeCreativeRedoAsk("new photos please")).toBe(true);
    expect(looksLikeCreativeRedoAsk("make the caption punchier")).toBe(false);
  });
});
