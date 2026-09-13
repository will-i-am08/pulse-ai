import { randomUUID } from "node:crypto";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { query, putMedia, getMedia, publicMediaUrl } from "@pulse/shared";
import type { Brand, PostFormat } from "@pulse/shared";
// Fonts embedded as base64 (see scripts/embed-fonts.ts) — identical in the Next
// serverless bundle and the worker, no file tracing / path issues.
import { interRegular as INTER_REGULAR, interBold as INTER_BOLD } from "./assets/fonts.generated.js";

export interface MockupInput {
  brandName: string;
  igUsername: string | null;
  caption: string | null;
  aspectRatio?: string | null;
  slideCount?: number;
}

const CAPTION_LIMIT = 125;
const MORE_SUFFIX = "… more";
const MAX_BYTES = 950_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SNode = any;
// NB: satori throws for a <div> with multiple children unless display is
// flex/contents/none — and even an empty children array trips its check, so
// childless nodes must carry NO children prop at all.
const el = (type: string, props: Record<string, SNode> | null, ...children: SNode[]): SNode => ({
  type,
  props: {
    ...(props ?? {}),
    ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }),
  },
});

/** Truncate a caption for the mockup preview; short captions pass through untouched. */
export function foldCaption(caption: string | null, limit = CAPTION_LIMIT): string {
  if (!caption) return "";
  const text = caption.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const folded = (lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:!?…]+$/, "");
  return `${folded} ${MORE_SUFFIX}`;
}

/** Parse "W:H" (e.g. "4:5", "1:1", "9:16"); anything else falls back to 4:5. */
function parseAspectRatio(raw: string | null | undefined): { w: number; h: number } {
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec((raw ?? "").trim());
  if (m) {
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= 32 && h <= 32) return { w, h };
  }
  return { w: 4, h: 5 };
}

function handleFor(input: MockupInput): string {
  return (input.igUsername ?? "").trim() || input.brandName;
}

function initialFor(brandName: string): string {
  return (brandName.trim()[0] ?? "?").toUpperCase();
}

async function toBudgetJpeg(png: Buffer): Promise<Buffer> {
  let quality = 82;
  let out = await sharp(png).jpeg({ quality }).toBuffer();
  while (out.length > MAX_BYTES && quality > 55) {
    quality -= 10;
    out = await sharp(png).jpeg({ quality }).toBuffer();
  }
  return out;
}

async function renderSatori(width: number, height: number, tree: SNode): Promise<Buffer> {
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width,
    height,
    fonts: [
      { name: "Inter", data: INTER_REGULAR, weight: 400, style: "normal" },
      { name: "Inter", data: INTER_BOLD, weight: 700, style: "normal" },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
}

// Feather-style stroked icons (heart / comment / share / save). No emoji, no
// counts — purely the recognisable affordances.
function iconSvg(d: string | string[], size: number): SNode {
  const paths = (Array.isArray(d) ? d : [d]).map((p) => el("path", { d: p }));
  return el(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "#262626",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    ...paths,
  );
}
const HEART = "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z";
const COMMENT =
  "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z";
const SEND = ["M22 2 11 13", "M22 2l-7 20-4-9-9-4 20-7z"];
const BOOKMARK = "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z";

/**
 * Render an Instagram feed-post mockup. Satori draws chrome only; sharp drops
 * the photo into the frame — no base64 photo through the layout engine.
 */
export async function renderFeedMockup(photoBytes: Uint8Array, input: MockupInput): Promise<Buffer> {
  const W = 1080;
  const { w: aw, h: ah } = parseAspectRatio(input.aspectRatio);
  const photoH = Math.max(566, Math.min(1350, Math.round((W * ah) / aw)));

  // Resize the photo once via sharp — never push base64 through Satori.
  const photo = await sharp(Buffer.from(photoBytes))
    .rotate()
    .resize({ width: W, height: photoH, fit: "cover" })
    .jpeg({ quality: 90 })
    .toBuffer();

  const handle = handleFor(input);
  const initial = initialFor(input.brandName);
  const folded = foldCaption(input.caption);
  const truncated = folded.endsWith(MORE_SUFFIX) && folded !== (input.caption ?? "");
  const body = truncated ? folded.slice(0, folded.length - MORE_SUFFIX.length).trimEnd() : folded;

  const headerH = 132;
  const actionH = 96;
  const padX = 36;
  const captionSize = 31;
  const captionLineH = Math.round(captionSize * 1.42);
  const contentW = W - padX * 2;
  const textLen = handle.length + 1 + folded.length;
  const charsPerLine = Math.max(20, Math.floor(contentW / (captionSize * 0.52)));
  const lines = Math.max(1, Math.ceil(textLen / charsPerLine));
  const captionH = folded ? (lines + 1) * captionLineH + 24 : 24;
  const timeH = 64;
  const bottomPad = 36;
  const totalH = headerH + photoH + actionH + captionH + timeH + bottomPad;

  const captionKids: SNode[] = [
    el("span", { style: { fontWeight: 700, marginRight: 12 } }, handle),
    el("span", {}, body),
  ];
  if (truncated) captionKids.push(el("span", { style: { color: "#6b6b6b", marginLeft: 12 } }, MORE_SUFFIX));

  // Photo hole is an empty flex spacer — sharp drops the JPEG into this band.
  const photoHoleKids: SNode[] = [];
  if ((input.slideCount ?? 1) > 1) {
    photoHoleKids.push(
      el(
        "div",
        {
          style: {
            position: "absolute",
            top: 24,
            right: 24,
            display: "flex",
            background: "rgba(0,0,0,0.72)",
            color: "white",
            fontSize: 30,
            padding: "10px 24px",
            borderRadius: 30,
          },
        },
        `1/${input.slideCount}`,
      ),
    );
  }

  const bottomKids: SNode[] = [
    el(
      "div",
      { style: { display: "flex", flexDirection: "row", alignItems: "center", padding: `0 ${padX}px`, height: actionH } },
      el("div", { style: { display: "flex", marginRight: 40 } }, iconSvg(HEART, 54)),
      el("div", { style: { display: "flex", marginRight: 40 } }, iconSvg(COMMENT, 54)),
      el("div", { style: { display: "flex" } }, iconSvg(SEND, 54)),
      el("div", { style: { display: "flex", marginLeft: "auto" } }, iconSvg(BOOKMARK, 54)),
    ),
  ];
  if (folded) {
    bottomKids.push(
      el(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            padding: `0 ${padX}px`,
            height: captionH,
            fontSize: captionSize,
            lineHeight: 1.42,
            color: "#111111",
          },
        },
        ...captionKids,
      ),
    );
  }
  bottomKids.push(
    el(
      "div",
      { style: { display: "flex", padding: `12px ${padX}px 0`, height: timeH } },
      el("div", { style: { display: "flex", fontSize: 27, color: "#8e8e8e" } }, "Just now"),
    ),
  );

  const chrome = el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        width: `${W}px`,
        height: `${totalH}px`,
        background: "white",
        fontFamily: "Inter",
      },
    },
    el(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          padding: `0 ${padX}px`,
          height: headerH,
        },
      },
      el(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 76,
            height: 76,
            borderRadius: 999,
            background: "#e9e9e9",
          },
        },
        el("div", { style: { display: "flex", fontSize: 34, fontWeight: 700, color: "#555555" } }, initial),
      ),
      el(
        "div",
        { style: { display: "flex", marginLeft: 24, fontSize: 36, fontWeight: 700, color: "#111111" } },
        handle,
      ),
      el("div", { style: { display: "flex", marginLeft: "auto", fontSize: 44, color: "#111111" } }, "…"),
    ),
    el(
      "div",
      {
        style: {
          display: "flex",
          position: "relative",
          width: `${W}px`,
          height: `${photoH}px`,
          background: "#111111",
        },
      },
      ...photoHoleKids,
    ),
    ...bottomKids,
  );

  const chromePng = await renderSatori(W, totalH, chrome);
  const composed = await sharp(chromePng)
    .composite([{ input: photo, top: headerH, left: 0 }])
    .png()
    .toBuffer();
  return toBudgetJpeg(composed);
}

/**
 * Render an Instagram story mockup: 1080x1920 full-bleed photo with a top
 * progress bar and avatar + handle. Photo is composited via sharp; Satori only
 * draws the chrome overlay.
 */
export async function renderStoryMockup(photoBytes: Uint8Array, input: MockupInput): Promise<Buffer> {
  const W = 1080;
  const H = 1920;

  const photo = await sharp(Buffer.from(photoBytes))
    .rotate()
    .resize({ width: W, height: H, fit: "cover" })
    .jpeg({ quality: 90 })
    .toBuffer();

  const handle = handleFor(input);
  const initial = initialFor(input.brandName);

  // Transparent overlay chrome — composited on top of the photo.
  const overlay = el(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        width: `${W}px`,
        height: `${H}px`,
        position: "relative",
        fontFamily: "Inter",
      },
    },
    el("div", {
      style: {
        position: "absolute",
        top: 0,
        left: 0,
        width: `${W}px`,
        height: 460,
        background: "linear-gradient(to bottom, rgba(0,0,0,0.45), rgba(0,0,0,0))",
      },
    }),
    el(
      "div",
      { style: { display: "flex", flexDirection: "column", padding: "36px 36px 0" } },
      el(
        "div",
        { style: { display: "flex", width: 1008, height: 8, borderRadius: 4, background: "rgba(255,255,255,0.35)" } },
        el("div", { style: { display: "flex", width: 352, height: 8, borderRadius: 4, background: "white" } }),
      ),
      el(
        "div",
        { style: { display: "flex", flexDirection: "row", alignItems: "center", marginTop: 28 } },
        el(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 68,
              height: 68,
              borderRadius: 999,
              background: "#e9e9e9",
            },
          },
          el("div", { style: { display: "flex", fontSize: 30, fontWeight: 700, color: "#555555" } }, initial),
        ),
        el(
          "div",
          { style: { display: "flex", marginLeft: 20, fontSize: 30, fontWeight: 700, color: "white" } },
          handle,
        ),
      ),
    ),
  );

  const overlayPng = await renderSatori(W, H, overlay);
  const composed = await sharp(photo)
    .composite([{ input: overlayPng, top: 0, left: 0 }])
    .png()
    .toBuffer();
  return toBudgetJpeg(composed);
}

export async function previewUrlForPost(
  brand: Brand,
  post: { caption: string | null; format: PostFormat; media_ids: string[] },
  photoId: string,
  opts?: {
    fetchMedia?: (id: string) => Promise<{ bytes: Buffer; contentType: string } | null>;
    renderFeed?: typeof renderFeedMockup;
    renderStory?: typeof renderStoryMockup;
    store?: typeof storeMockup;
  },
): Promise<string> {
  const fallback = publicMediaUrl(photoId);
  try {
    const fetch = opts?.fetchMedia ?? getMedia;
    const got = await fetch(photoId);
    if (!got) throw new Error(`previewUrlForPost: no bytes for media ${photoId}`);
    // The "1/N" pip is a carousel affordance — feed posts (whose media_ids can
    // hold a styled copy alongside the original) always render a single frame.
    const input: MockupInput = {
      brandName: brand.name,
      igUsername: brand.ig_username,
      caption: post.caption,
      aspectRatio: brand.visual?.aspect_ratio ?? null,
      slideCount: post.format === "carousel" ? Math.max(1, post.media_ids.length) : 1,
    };
    const renderFeed = opts?.renderFeed ?? renderFeedMockup;
    const renderStory = opts?.renderStory ?? renderStoryMockup;
    const store = opts?.store ?? storeMockup;
    const bytes = new Uint8Array(got.bytes);
    const buf = post.format === "story" ? await renderStory(bytes, input) : await renderFeed(bytes, input);
    const id = await store(brand.id, Buffer.from(buf));
    return publicMediaUrl(id);
  } catch (err) {
    console.error("previewUrlForPost: falling back to original photo", err);
    return fallback;
  }
}

/**
 * Store a rendered mockup as an operator-sourced photo asset. Kept OUT of
 * posts.media_ids by the caller (it only ever previews the draft), so it can
 * never leak into the publish loop; source='operator' keeps it out of the
 * client photo bank. Returns the new media id.
 */
export async function storeMockup(brandId: string, pngOrJpeg: Buffer, contentType = "image/jpeg"): Promise<string> {
  const id = randomUUID();
  await query(
    `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
     values ($1, $2, $3, 'photo', 'operator', $4)`,
    [id, brandId, id, contentType],
  );
  await putMedia(id, new Uint8Array(pngOrJpeg), contentType);
  return id;
}
