/**
 * Canva-style decorative kit composited onto stills.
 * Pieces are chosen per still (owner ask or agent), not stamped on every photo.
 * Lane only tints bar weight — never a niche table.
 *
 * Visibility rule: when deco is on, a human must see the ornaments without
 * squinting. Hairline bars on the bleed edge and 8px black pills fail.
 */
import sharp from "sharp";
import type { BrandDecoKit, BrandVisualLane, DecoPiece } from "./brandElements.js";

function svgEscape(hex: string): string {
  const t = hex.trim();
  return /^#[0-9a-fA-F]{6}$/.test(t) ? t : "#ffffff";
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = svgEscape(hex);
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

const CREAM = "#f5f0e8";
const INK = "#1a1a1a";

export type DecoPaint = { fill: string; ink: string; stroke: string };

/** Pick a fill that pops on the still — never a near-black pill on a dark photo. */
export function pickDecoPaint(
  requested: { stroke: string; fill: string; accent: string },
  photoLuminance: number,
): DecoPaint {
  const candidates = [requested.accent, requested.fill, requested.stroke, CREAM, INK].map(svgEscape);
  if (photoLuminance < 0.42) {
    const lights = candidates.filter((c) => relativeLuminance(c) >= 0.45);
    const fill = lights.sort((a, b) => relativeLuminance(b) - relativeLuminance(a))[0] ?? CREAM;
    return { fill, ink: INK, stroke: INK };
  }
  const darks = candidates.filter((c) => relativeLuminance(c) <= 0.4);
  const fill = darks.sort((a, b) => relativeLuminance(a) - relativeLuminance(b))[0] ?? INK;
  return { fill, ink: CREAM, stroke: CREAM };
}

export async function samplePhotoLuminance(base: Buffer): Promise<number> {
  const thumb = await sharp(base).resize(16, 16, { fit: "fill" }).removeAlpha().raw().toBuffer();
  let sum = 0;
  const n = Math.floor(thumb.length / 3);
  for (let i = 0; i < n; i++) {
    const r = thumb[i * 3]! / 255;
    const g = thumb[i * 3 + 1]! / 255;
    const b = thumb[i * 3 + 2]! / 255;
    const lin = [r, g, b].map((s) => (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
    sum += 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
  }
  return n ? sum / n : 0.2;
}

export type DecoLayout = {
  gutter: number;
  barW: number;
  barX: number;
  stickerW: number;
  stickerH: number;
  stickerX: number;
  stickerY: number;
  frameStroke: number;
  frameInset: number;
  ribbonH: number;
  cornerArm: number;
  underlineW: number;
  underlineH: number;
  badgeW: number;
  badgeH: number;
  circleR: number;
  shapeS: number;
  dotsR: number;
};

/** Geometry so ornaments sit IN the photo at a readable size — not 8px on the crop edge. */
export function decoLayout(width: number, height: number, lane: BrandVisualLane): DecoLayout {
  const min = Math.min(width, height);
  const gutter = Math.max(40, Math.round(width * 0.045));
  const barW = lane === "industrial" ? Math.max(64, Math.round(width * 0.08)) : Math.max(56, Math.round(width * 0.07));
  const ribbonH = Math.max(72, Math.round(height * 0.09));
  const stickerW = Math.max(220, Math.round(width * 0.28));
  const stickerH = Math.max(96, Math.round(height * 0.12));
  const stickerX = width - gutter - stickerW;
  const stickerY = gutter;
  return {
    gutter,
    barW,
    barX: gutter,
    stickerW,
    stickerH,
    stickerX,
    stickerY,
    frameStroke: Math.max(10, Math.round(width * 0.011)),
    frameInset: Math.max(48, Math.round(min * 0.055)),
    ribbonH,
    cornerArm: Math.max(72, Math.round(min * 0.1)),
    underlineW: Math.round(width * 0.42),
    underlineH: Math.max(10, Math.round(height * 0.014)),
    badgeW: Math.max(180, Math.round(width * 0.22)),
    badgeH: Math.max(80, Math.round(height * 0.1)),
    circleR: Math.max(36, Math.round(width * 0.055)),
    shapeS: Math.max(28, Math.round(width * 0.04)),
    dotsR: Math.max(10, Math.round(width * 0.015)),
  };
}

function pieceSet(pieces: DecoPiece[]): Set<DecoPiece> {
  return new Set(pieces);
}

/** Full-bleed SVG decoration (alpha) composited over a still. */
export async function compositeBrandDecoration(
  base: Buffer,
  kit: BrandDecoKit,
  colors: { stroke: string; fill: string; accent: string },
): Promise<Buffer> {
  const meta = await sharp(base).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;
  const set = pieceSet(kit.pieces);
  if (!set.size) return base;

  const photoLum = await samplePhotoLuminance(base);
  const paint = pickDecoPaint(colors, photoLum);
  const fill = paint.fill;
  const ink = paint.ink;
  const stroke = paint.stroke;
  const L = decoLayout(width, height, kit.lane);
  const parts: string[] = [];

  if (set.has("ribbon")) {
    parts.push(`<rect x="0" y="0" width="${width}" height="${L.ribbonH}" fill="${fill}"/>`);
    parts.push(
      `<rect x="0" y="${L.ribbonH}" width="${width}" height="${Math.max(6, Math.round(L.ribbonH * 0.12))}" fill="${ink}" fill-opacity="0.85"/>`,
    );
  }
  if (set.has("bar")) {
    const y0 = set.has("ribbon") ? L.ribbonH : 0;
    parts.push(`<rect x="${L.barX}" y="${y0}" width="${L.barW}" height="${height - y0}" fill="${fill}"/>`);
    parts.push(
      `<rect x="${L.barX + L.barW}" y="${y0}" width="${Math.max(4, Math.round(L.barW * 0.12))}" height="${height - y0}" fill="${ink}" fill-opacity="0.8"/>`,
    );
  }
  if (set.has("frame")) {
    const x = L.frameInset;
    const y = L.frameInset;
    const w = Math.max(1, width - L.frameInset * 2);
    const h = Math.max(1, height - L.frameInset * 2);
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="${L.frameStroke}"/>`,
    );
  }
  if (set.has("corners")) {
    const inset = L.frameInset;
    const arm = L.cornerArm;
    const sw = L.frameStroke + 2;
    const x2 = width - inset;
    const y2 = height - inset;
    const d = [
      `M ${inset} ${inset + arm} L ${inset} ${inset} L ${inset + arm} ${inset}`,
      `M ${x2 - arm} ${inset} L ${x2} ${inset} L ${x2} ${inset + arm}`,
      `M ${inset} ${y2 - arm} L ${inset} ${y2} L ${inset + arm} ${y2}`,
      `M ${x2 - arm} ${y2} L ${x2} ${y2} L ${x2} ${y2 - arm}`,
    ];
    for (const path of d) {
      parts.push(`<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="square"/>`);
    }
  }
  if (set.has("rule")) {
    const rw = Math.round(width * 0.38);
    const rh = Math.max(8, Math.round(height * 0.012));
    const rx = L.frameInset + (set.has("bar") ? L.barW + L.gutter * 0.3 : 0);
    const ry = height - L.frameInset - rh;
    parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fill}"/>`);
  }
  if (set.has("underline")) {
    const ux = Math.round((width - L.underlineW) / 2);
    const uy = Math.round(height * 0.7);
    parts.push(`<rect x="${ux}" y="${uy}" width="${L.underlineW}" height="${L.underlineH}" fill="${fill}"/>`);
  }
  if (set.has("shape")) {
    const s = L.shapeS;
    const cx = L.frameInset + L.cornerArm + Math.round(s * 1.2);
    const cy = (set.has("ribbon") ? L.ribbonH : 0) + L.frameInset + s;
    parts.push(
      `<rect x="${cx - s}" y="${cy - s}" width="${s * 2}" height="${s * 2}" fill="${fill}" stroke="${ink}" stroke-width="4" transform="rotate(45 ${cx} ${cy})"/>`,
    );
  }
  if (set.has("circle")) {
    const r = L.circleR;
    const cx = width - L.frameInset - r;
    const cy = (set.has("ribbon") ? L.ribbonH : 0) + L.frameInset + r;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${L.frameStroke}"/>`);
  }
  if (set.has("sticker")) {
    const sx = L.stickerX;
    const sy = (set.has("ribbon") ? L.ribbonH + Math.round(L.gutter * 0.4) : L.stickerY);
    const cx = sx + L.stickerW / 2;
    const cy = sy + L.stickerH / 2;
    const rx = Math.round(L.stickerH * 0.48);
    const sw = Math.max(6, Math.round(L.stickerH * 0.08));
    const innerPad = Math.max(8, Math.round(L.stickerH * 0.14));
    parts.push(
      `<g transform="rotate(-12 ${cx} ${cy})">` +
        `<rect x="${sx}" y="${sy}" width="${L.stickerW}" height="${L.stickerH}" rx="${rx}" fill="${fill}" stroke="${ink}" stroke-width="${sw}"/>` +
        `<rect x="${sx + innerPad}" y="${sy + innerPad}" width="${L.stickerW - innerPad * 2}" height="${L.stickerH - innerPad * 2}" rx="${Math.max(8, rx - innerPad)}" fill="none" stroke="${ink}" stroke-width="${Math.max(3, Math.round(sw * 0.45))}" stroke-opacity="0.7"/>` +
        `</g>`,
    );
  }
  if (set.has("badge")) {
    const bw = L.badgeW;
    const bh = L.badgeH;
    const bx = set.has("sticker") ? L.barX + (set.has("bar") ? L.barW + 12 : 0) : width - L.gutter - bw;
    const by = (set.has("ribbon") ? L.ribbonH + 12 : L.gutter);
    const rx = Math.round(bh * 0.22);
    const diamond = Math.round(Math.min(bw, bh) * 0.22);
    const dcx = bx + bw / 2;
    const dcy = by + bh / 2;
    parts.push(
      `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${rx}" fill="${fill}" stroke="${ink}" stroke-width="6"/>`,
      `<rect x="${dcx - diamond}" y="${dcy - diamond}" width="${diamond * 2}" height="${diamond * 2}" fill="${ink}" transform="rotate(45 ${dcx} ${dcy})"/>`,
    );
  }
  if (set.has("dots")) {
    const r = L.dotsR;
    const gap = Math.round(r * 3.4);
    const y = (set.has("ribbon") ? L.ribbonH : 0) + L.gutter + r;
    const start = Math.round(width / 2 - gap);
    for (let i = 0; i < 3; i++) {
      parts.push(`<circle cx="${start + i * gap}" cy="${y}" r="${r}" fill="${fill}" stroke="${ink}" stroke-width="3"/>`);
    }
  }

  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`,
  );
  const overlay = await sharp(svg).png().toBuffer();
  const out = await sharp(base)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  return Buffer.from(out);
}
