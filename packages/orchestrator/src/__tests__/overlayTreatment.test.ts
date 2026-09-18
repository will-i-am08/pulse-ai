import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inferOverlayTreatment,
  resolveOverlayTreatment,
  cycleOverlayPlacement,
  splitOverlayStack,
  overlayWordNodes,
  formatOverlayHeadline,
  DEFAULT_OVERLAY_TREATMENT,
  OVERLAY_STYLE_CYCLE,
  OVERLAY_HEADLINE_MAX_WORDS,
  OVERLAY_HEADLINE_MAX_CHARS,
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
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "text over the top",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "small caption in the corner",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "put a chip caption on it",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "text in the middle",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "text at the top",
      want: { placement: "top", stack: "stack", face: "anton" },
    },
    {
      ask: "bottom left caption",
      want: { placement: "low_left", stack: "stack", face: "anton" },
    },
    {
      ask: "",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "post this photo",
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "text over the top",
      visual: { fonts: ["Impact"] },
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "text over the top",
      visual: { fonts: ["Playfair Display"] },
      want: { placement: "center", stack: "stack", face: "inter" },
    },
    {
      ask: "post this",
      visual: { fonts: ["Anton"] },
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "small caption in the corner",
      visual: { fonts: ["Impact"] },
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "carousel of cinematic cars",
      opts: { ideaBlurb: true },
      want: { placement: "center", stack: "stack", face: "anton" },
    },
    {
      ask: "cinematic carousel",
      opts: { mixedFonts: true },
      want: { placement: "center", stack: "stack", face: "anton" },
    },
  ];

  it("maps owner asks to the v1 recipe table", () => {
    for (const { ask, visual, opts, want } of cases) {
      expect(inferOverlayTreatment(ask, visual, opts), JSON.stringify({ ask, visual, opts })).toEqual(
        want,
      );
    }
  });

  it("defaults to stacked Anton in the middle when the owner says nothing", () => {
    expect(inferOverlayTreatment(null)).toEqual(DEFAULT_OVERLAY_TREATMENT);
    expect(inferOverlayTreatment(undefined, {})).toEqual(DEFAULT_OVERLAY_TREATMENT);
    expect(DEFAULT_OVERLAY_TREATMENT).toEqual({
      placement: "center",
      stack: "stack",
      face: "anton",
    });
  });

  it("rotates unlocked asks through center, top, then bottom", () => {
    expect(OVERLAY_STYLE_CYCLE).toEqual(["center", "top", "bottom"]);
    expect(cycleOverlayPlacement(0)).toBe("center");
    expect(cycleOverlayPlacement(1)).toBe("top");
    expect(cycleOverlayPlacement(2)).toBe("bottom");
    expect(cycleOverlayPlacement(3)).toBe("center");
    expect(inferOverlayTreatment("text over the top", {}, { slideIndex: 1 })).toEqual({
      placement: "top",
      stack: "stack",
      face: "anton",
    });
    expect(inferOverlayTreatment("text over the top", {}, { slideIndex: 2 })).toEqual({
      placement: "bottom",
      stack: "stack",
      face: "anton",
    });
    expect(
      inferOverlayTreatment("designed tip slide", {}, { slideIndex: 2 }),
    ).toEqual({ placement: "center", stack: "stack", face: "anton" });
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
    ).toEqual({ placement: "center", stack: "stack", face: "inter" });
  });

  it("treats idea body as Anton title in the middle", () => {
    expect(resolveOverlayTreatment({ body: "who pays and why now" }, {})).toEqual({
      placement: "center",
      stack: "stack",
      face: "anton",
    });
  });
});

describe("splitOverlayStack", () => {
  it("puts each formatted word on its own line so Anton cannot smash", () => {
    const lines = splitOverlayStack("floss the 40% your brush misses");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_WORDS);
    expect(lines.join(" ")).toContain("40%");
    expect(lines.join(" ")).not.toMatch(/(^|\s)40(\s|$)/);
    for (const line of lines) {
      expect(line).toBe(formatOverlayHeadline(line));
      expect(line.split(/\s+/).filter(Boolean)).toHaveLength(1);
      expect(line.length).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_CHARS);
    }
  });

  it("keeps a one-word headline as a single line", () => {
    expect(splitOverlayStack("BREW")).toEqual(["BREW"]);
  });

  it("returns one line per word for a short phrase", () => {
    const lines = splitOverlayStack("brew better");
    expect(lines).toEqual(["BREW", "BETTER"]);
  });

  it("never leaves two words on the same stacked line", () => {
    const lines = splitOverlayStack("FLOSS THE 40% YOUR BRUSH MISSES EVERY SINGLE TIME");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(OVERLAY_HEADLINE_MAX_WORDS);
    for (const line of lines) {
      expect(line.split(/\s+/).filter(Boolean)).toHaveLength(1);
    }
  });
});

describe("overlayWordNodes", () => {
  it("keeps each word as its own node with a fixed-width spacer between", () => {
    const nodes = overlayWordNodes("FORTY FIVE DAYS HANGING", 12);
    expect(nodes).toHaveLength(7);
    expect(nodes.map((n) => n.props.children)).toEqual([
      "FORTY",
      "\u00A0",
      "FIVE",
      "\u00A0",
      "DAYS",
      "\u00A0",
      "HANGING",
    ]);
    expect(nodes[1]!.props.style).toMatchObject({ width: 12, minWidth: 12 });
    expect(nodes[0]!.props.style).not.toHaveProperty("marginRight");
  });

  it("does not emit an empty node for blank input", () => {
    expect(overlayWordNodes("   ", 8)).toEqual([]);
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
    expect(renderTile).toMatch(/letterSpacing: "0\.03em"/);
    expect(renderTile).toMatch(/textShadow:/);
    expect(renderTile).toMatch(/overlayWordNodes\(/);
    expect(renderTile).toMatch(/overlaySafeInset\(/);
    expect(renderTile).toMatch(/overlayBandStyle\(/);
    expect(imaging).not.toMatch(/borderRadius/);
    expect(renderTile).not.toMatch(/:\s*undefined/);
    expect(imaging).toMatch(/placement === "center"/);
    expect(imaging).toMatch(/placement === "chip"/);
    expect(imaging).toMatch(/placement === "low_left"/);
    expect(imaging).toMatch(/placement === "top"/);
    expect(imaging).toMatch(/slideIndex/);
  });

  it("formats and inbound pass the owner ask into applyTextTile", () => {
    const formats = readFileSync(join(here, "../formats.ts"), "utf8");
    const fillers = readFileSync(join(here, "../fillers.ts"), "utf8");
    const inbound = readFileSync(join(here, "../processInbound.ts"), "utf8");
    expect(formats).toMatch(/ask:\s*brief/);
    expect(formats).toMatch(/ask:\s*topic/);
    expect(formats).toMatch(/slideIndex:\s*i/);
    expect(formats).toMatch(/slideIndex:\s*index/);
    expect(fillers).toMatch(/ask:\s*topic/);
    expect(inbound).toMatch(/ask:\s*message\.body/);
  });
});
