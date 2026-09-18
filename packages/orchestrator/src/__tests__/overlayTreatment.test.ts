import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferOverlayTreatment,
  resolveOverlayTreatment,
  splitOverlayStack,
  formatOverlayHeadline,
  DEFAULT_OVERLAY_TREATMENT,
  OVERLAY_HEADLINE_MAX_WORDS,
  OVERLAY_HEADLINE_MAX_CHARS,
  OVERLAY_TRAILING_FUNCTION_WORDS,
} from "../imaging.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("inferOverlayTreatment", () => {
  const cases: Array<{
    ask: string;
    visual?: { fonts?: string[] };
    opts?: { ideaBlurb?: boolean; mixedFonts?: boolean };
    want: ReturnType<typeof inferOverlayTreatment>;
  }> = [
    {
      ask: "designed tip slide on a photo",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "make a designed tip slide",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "text card on a photo",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "big stacked type",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "carousel with cinematic photos with text over the top",
      want: { placement: "bottom", stack: "single", face: "inter" },
    },
    {
      ask: "text over the top",
      want: { placement: "bottom", stack: "single", face: "inter" },
    },
    {
      ask: "small caption in the corner",
      want: { placement: "chip", stack: "single", face: "inter" },
    },
    {
      ask: "put a chip caption on it",
      want: { placement: "chip", stack: "single", face: "inter" },
    },
    {
      ask: "text at the top",
      want: { placement: "top", stack: "single", face: "inter" },
    },
    {
      ask: "bottom left caption",
      want: { placement: "low_left", stack: "single", face: "inter" },
    },
    {
      ask: "",
      want: { placement: "bottom", stack: "single", face: "inter" },
    },
    {
      ask: "post this photo",
      want: { placement: "bottom", stack: "single", face: "inter" },
    },
    {
      ask: "text over the top",
      visual: { fonts: ["Impact"] },
      want: { placement: "bottom", stack: "single", face: "anton" },
    },
    {
      ask: "text over the top",
      visual: { fonts: ["Playfair Display"] },
      want: { placement: "bottom", stack: "single", face: "inter" },
    },
    {
      ask: "post this",
      visual: { fonts: ["Anton"] },
      want: { placement: "bottom", stack: "single", face: "anton" },
    },
    {
      ask: "small caption in the corner",
      visual: { fonts: ["Impact"] },
      want: { placement: "chip", stack: "single", face: "inter" },
    },
    {
      ask: "carousel of cinematic cars",
      opts: { ideaBlurb: true },
      want: { placement: "bottom", stack: "single", face: "anton" },
    },
    {
      ask: "cinematic carousel",
      opts: { mixedFonts: true },
      want: { placement: "bottom", stack: "single", face: "anton" },
    },
  ];

  it("maps owner asks to the v1 recipe table", () => {
    for (const { ask, visual, opts, want } of cases) {
      expect(inferOverlayTreatment(ask, visual, opts), JSON.stringify({ ask, visual, opts })).toEqual(
        want,
      );
    }
  });

  it("defaults to today's bottom Inter band when the owner says nothing", () => {
    expect(inferOverlayTreatment(null)).toEqual(DEFAULT_OVERLAY_TREATMENT);
    expect(inferOverlayTreatment(undefined, {})).toEqual(DEFAULT_OVERLAY_TREATMENT);
  });
});

describe("resolveOverlayTreatment", () => {
  it("uses an explicit treatment over the ask", () => {
    expect(
      resolveOverlayTreatment(
        {
          ask: "designed tip slide",
          treatment: { placement: "chip", stack: "single", face: "inter" },
        },
        {},
      ),
    ).toEqual({ placement: "chip", stack: "single", face: "inter" });
  });

  it("treats idea body as Anton title on the default band", () => {
    expect(resolveOverlayTreatment({ body: "who pays and why now" }, {})).toEqual({
      placement: "bottom",
      stack: "single",
      face: "anton",
    });
  });
});

describe("splitOverlayStack", () => {
  it("splits a formatted headline on word boundaries into 2–3 lines", () => {
    const lines = splitOverlayStack("floss the 40% your brush misses");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join(" ")).toContain("40%");
    expect(lines.join(" ")).not.toMatch(/(^|\s)40(\s|$)/);
    for (const line of lines) {
      expect(line).toBe(formatOverlayHeadline(line));
      expect(line.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_WORDS);
      expect(line.length).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_CHARS);
    }
  });

  it("keeps a one-word headline as a single line", () => {
    expect(splitOverlayStack("BREW")).toEqual(["BREW"]);
  });

  it("returns two lines for a short phrase", () => {
    const lines = splitOverlayStack("brew better");
    expect(lines).toEqual(["BREW", "BETTER"]);
  });

  it("never leaves a multi-word line on a trailing function word", () => {
    const lines = splitOverlayStack("FLOSS THE 40% YOUR BRUSH MISSES EVERY SINGLE TIME");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) {
      const parts = line.split(/\s+/).filter(Boolean);
      if (parts.length > 1) {
        expect(OVERLAY_TRAILING_FUNCTION_WORDS.has(parts[parts.length - 1]!)).toBe(false);
      }
    }
  });
});

describe("overlay treatment wiring", () => {
  it("applyTextTile infers a treatment and formats per line", () => {
    const imaging = readFileSync(join(here, "../imaging.ts"), "utf8");
    const applyTextTile = imaging.slice(
      imaging.indexOf("export async function applyTextTile"),
      imaging.indexOf("export async function applyStoryCreative"),
    );
    expect(applyTextTile).toMatch(/resolveOverlayTreatment\(/);
    expect(applyTextTile).toMatch(/splitOverlayStack\(/);
    expect(applyTextTile).toMatch(/formatOverlayHeadline\(/);
  });

  it("renderTile branches on placement and keeps the default 0.06em track", () => {
    const imaging = readFileSync(join(here, "../imaging.ts"), "utf8");
    const renderTile = imaging.slice(
      imaging.indexOf("async function renderTile"),
      imaging.indexOf("export async function applyTextTile"),
    );
    expect(renderTile).toMatch(/letterSpacing: treatment\.placement === "chip" \? "0\.04em" : "0\.06em"/);
    expect(renderTile).toMatch(/overlaySafeInset\(/);
    expect(renderTile).toMatch(/overlayBandStyle\(/);
    expect(renderTile).not.toMatch(/:\s*undefined/);
    expect(imaging).toMatch(/placement === "center"/);
    expect(imaging).toMatch(/placement === "chip"/);
    expect(imaging).toMatch(/placement === "low_left"/);
    expect(imaging).toMatch(/placement === "top"/);
  });

  it("formats and inbound pass the owner ask into applyTextTile", () => {
    const formats = readFileSync(join(here, "../formats.ts"), "utf8");
    const fillers = readFileSync(join(here, "../fillers.ts"), "utf8");
    const inbound = readFileSync(join(here, "../processInbound.ts"), "utf8");
    expect(formats).toMatch(/ask:\s*brief/);
    expect(formats).toMatch(/ask:\s*topic/);
    expect(fillers).toMatch(/ask:\s*topic/);
    expect(inbound).toMatch(/ask:\s*message\.body/);
  });
});
