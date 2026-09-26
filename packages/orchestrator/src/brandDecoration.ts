/**
 * Canva-style decorative kit composited onto stills.
 * Lane is derived from visual tokens (fonts, aesthetic, palette) — not a niche table.
 * Same kit repeats for the brand; mark vs constructed only changes intensity.
 */
import sharp from "sharp";
import type { BrandDecoKit, DecoPiece } from "./brandElements.js";

function svgEscape(hex: string): string {
  const t = hex.trim();
  return /^#[0-9a-fA-F]{6}$/.test(t) ? t : "#ffffff";
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

  const stroke = svgEscape(colors.stroke);
  const fill = svgEscape(colors.fill);
  const accent = svgEscape(colors.accent);
  const inset = Math.max(28, Math.round(Math.min(width, height) * 0.042));
  const arm = Math.max(36, Math.round(Math.min(width, height) * 0.058));
  const sw = Math.max(3, Math.round(width * 0.0042));
  const barW = kit.lane === "industrial" ? Math.max(14, Math.round(width * 0.028)) : Math.max(8, Math.round(width * 0.016));
  const parts: string[] = [];

  if (set.has("bar")) {
    parts.push(`<rect x="0" y="0" width="${barW}" height="${height}" fill="${accent}"/>`);
  }
  if (set.has("frame")) {
    const x = inset;
    const y = inset;
    const w = Math.max(1, width - inset * 2);
    const h = Math.max(1, height - inset * 2);
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-opacity="0.92"/>`,
    );
  }
  if (set.has("corners")) {
    const x2 = width - inset;
    const y2 = height - inset;
    const d = [
      `M ${inset} ${inset + arm} L ${inset} ${inset} L ${inset + arm} ${inset}`,
      `M ${x2 - arm} ${inset} L ${x2} ${inset} L ${x2} ${inset + arm}`,
      `M ${inset} ${y2 - arm} L ${inset} ${y2} L ${inset + arm} ${y2}`,
      `M ${x2 - arm} ${y2} L ${x2} ${y2} L ${x2} ${y2 - arm}`,
    ];
    for (const path of d) {
      parts.push(
        `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="${sw + 1}" stroke-linecap="square" stroke-opacity="0.95"/>`,
      );
    }
  }
  if (set.has("rule")) {
    const rw = Math.round(width * 0.22);
    const rh = Math.max(3, Math.round(height * 0.006));
    const rx = inset + (set.has("bar") ? barW : 0);
    const ry = height - inset - rh;
    parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${accent}"/>`);
  }
  if (set.has("shape")) {
    const s = Math.max(8, Math.round(width * 0.012));
    const cx = inset + arm + Math.round(s * 1.6);
    const cy = inset + Math.round(s * 0.4);
    parts.push(
      `<rect x="${cx - s}" y="${cy - s}" width="${s * 2}" height="${s * 2}" fill="${fill}" transform="rotate(45 ${cx} ${cy})"/>`,
    );
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
