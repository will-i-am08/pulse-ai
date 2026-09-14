import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import {
  query,
  getMedia,
  putMedia,
  getServerEnv,
  sanitizeChatText,
  brandVoiceProfileSchema,
  type Brand,
  type VisualProfile,
} from "@pulse/shared";
import { callLLM } from "./llm.js";
import { routeImageJob } from "./modelRouter.js";
// Fonts are embedded as base64 (see scripts/embed-fonts.ts) so they load the same
// in the Next serverless bundle and the worker — no file tracing / path issues.
import { anton as ANTON, serif as SERIF, interRegular as INTER_REGULAR, interBold as INTER_BOLD } from "./assets/fonts.generated.js";
import { looksLikePhotoBackgroundAsk } from "./visualMode.js";

// ─── Brand visual tokens → render palette ────────────────────────────────────

type BrandPalette = {
  bgFrom: string;
  bgTo: string;
  text: string;
  muted: string;
  displayFont: "Anton" | "Playfair" | "Inter";
  bodyFont: "Anton" | "Playfair" | "Inter";
};

function normalizeHex(raw: string | undefined): string | null {
  if (!raw) return null;
  let c = raw.trim();
  // Named colours we allow without hex.
  const named: Record<string, string> = {
    black: "#141414",
    white: "#ffffff",
    cream: "#f5f0e8",
    navy: "#0b1f3a",
    forest: "#1a3a2a",
    charcoal: "#2a2a2a",
  };
  const lower = c.toLowerCase();
  if (named[lower]) return named[lower];
  if (!c.startsWith("#")) c = `#${c}`;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    const r = c[1],
      g = c[2],
      b = c[3];
    c = `#${r}${r}${g}${g}${b}${b}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
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

function contrastText(bg: string): string {
  return relativeLuminance(bg) > 0.45 ? "#1a1a1a" : "#ffffff";
}

function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(m(A.r, B.r))}${h(m(A.g, B.g))}${h(m(A.b, B.b))}`;
}

/** Resolve quote-card / tile colours + font roles from VisualProfile (sensible dark defaults). */
export function resolveBrandPalette(visual?: VisualProfile | null): BrandPalette {
  const colors = (visual?.colors ?? []).map(normalizeHex).filter((c): c is string => Boolean(c));
  const bgFrom = colors[0] ?? "#141414";
  const bgTo = colors[1] ?? (colors[0] ? mixHex(colors[0], "#000000", 0.25) : "#2a2a2a");
  const text = colors[2] ? colors[2] : contrastText(bgFrom);
  const muted = mixHex(text, bgFrom, 0.35);

  const fonts = (visual?.fonts ?? []).map((f) => f.toLowerCase());
  const wantsSerif = fonts.some((f) => /serif|playfair|georgia|garamond|times|didot|bodoni|editorial/.test(f));
  const wantsDisplay = fonts.some((f) => /anton|impact|bebas|display|condensed|oswald|archivo black/.test(f));
  const wantsSans = fonts.some((f) => /sans|helvetica|arial|montserrat|inter|futura|gothic|roboto|open sans|lato|poppins|dm sans|neue|linear/.test(f));
  // Default: Inter — clean/linear when no website fonts. Serif → Playfair. Impact display → Anton. Sans → Inter.
  let displayFont: "Anton" | "Playfair" | "Inter" = "Inter";
  let bodyFont: "Anton" | "Playfair" | "Inter" = "Inter";
  if (wantsSerif) {
    displayFont = "Playfair";
    bodyFont = "Playfair";
  } else if (wantsDisplay) {
    displayFont = "Anton";
    bodyFont = "Inter";
  } else if (wantsSans || fonts.length === 0) {
    displayFont = "Inter";
    bodyFont = "Inter";
  }


  return { bgFrom, bgTo, text, muted, displayFont, bodyFont };
}

// AI image editing via Replicate (Flux Kontext by default). The agent writes a
// tailored edit instruction from the actual photo + brand, then runs the model.
// Business = truthful (keep the real subject, improve it); personal = bolder.

type ContentPart = Exclude<Anthropic.MessageParam["content"], string>[number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Brand visual + learned photo_style cues for Flux edit prompts (Phase C1).
 * Exported for tests — must include photo_style fields when present on voice.
 */
export function brandPhotoStyleBits(brand: Brand): string[] {
  const visual = brand.visual ?? {};
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const ps = profile.photo_style;
  return [
    visual.aesthetic,
    visual.aesthetic_notes,
    visual.photo_treatment,
    visual.colors?.length ? `lean into colours ${visual.colors.join(", ")}` : "",
    visual.fonts?.length ? `type/brand feel ${visual.fonts.join(", ")}` : "",
    ps.overall_aesthetic ? `photo style aesthetic: ${ps.overall_aesthetic}` : "",
    ps.lighting ? `lighting: ${ps.lighting}` : "",
    ps.composition ? `composition: ${ps.composition}` : "",
    ps.editing ? `editing grade: ${ps.editing}` : "",
    ps.colour_palette?.length ? `photo colours: ${ps.colour_palette.join(", ")}` : "",
    ps.framing ? `framing: ${ps.framing}` : "",
    ps.common_subjects?.length ? `common subjects: ${ps.common_subjects.join(", ")}` : "",
    ps.recurring_motifs?.length ? `motifs: ${ps.recurring_motifs.join(", ")}` : "",
  ].filter((b): b is string => Boolean(b));
}

/** Vision LLM: given the photo + brand (+ the client's own request), write a Flux Kontext edit instruction. */
export async function generateEditPrompt(
  brand: Brand,
  imgBytes: Uint8Array,
  request?: string,
): Promise<string> {
  const business = brand.account_type !== "personal";
  // Strip any "add text" intent — text is burned on deterministically by the tile,
  // never by the image model (whose text comes out mangled).
  const asked0 = (request ?? "")
    .replace(/\b(with\s+)?(text|a\s+caption|caption|words|a\s+title|title|a\s+headline|headline|writing)\b(\s+on(\s+(it|the\s+\w+))?)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const asked = asked0.length > 2 ? asked0 : "";
  const styleBits = brandPhotoStyleBits(brand);
  const system = [
    "You write ONE vivid image-editing instruction for the Flux Kontext model that turns a client's phone photo into a scroll-stopping social-media image. The change must be clearly visible and worth it — a real transformation, never a timid touch-up.",
    business
      ? "BUSINESS account — FAITHFUL ENHANCEMENT DEFAULT: keep the real subject/product/premises truthful and recognisable. Improve lighting, colour fidelity, tidiness and polish like a pro product shoot. Do NOT reinvent, replace, or misrepresent the product, place, or people. No fantasy props, no fake packaging, no relocated storefront."
      : "PERSONAL/creator account: go bold and cinematic — dramatic directional lighting, rich contrast and a strong colour grade, striking and high-energy — while keeping the subject clearly recognisable.",
    styleBits.length ? `Brand visual + photo_style direction: ${styleBits.join("; ")}.` : "",
    asked ? `MOST IMPORTANT — the client specifically asked for: "${asked}". Honour that request above everything else (still keep business subjects truthful).` : "",
    "Keep the exposure natural and balanced: well-lit with clear detail in both the shadows and the highlights. Even a cinematic look must stay clean and readable — never dark, murky or underexposed, and never overexposed, washed-out or blown-out.",
    "Do NOT add any text, words, letters, captions, watermarks or logos to the image — keep it clean; any text is added separately.",
    "Base it on what is actually in the photo. Output ONLY the instruction (one or two sentences), no preamble, no quotes.",
  ]
    .filter(Boolean)
    .join("\n");

  const small = await sharp(Buffer.from(imgBytes))
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
  const content: ContentPart[] = [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.toString("base64") } },
    { type: "text", text: `Brand: "${brand.name}". Write the single edit instruction now.` },
  ];
  const out = await callLLM({ system, messages: [{ role: "user", content }], maxTokens: 150 });
  return out.trim();
}

/** Run the Replicate image model on the bytes with the prompt. Returns the edited JPEG bytes. */
async function replicateEdit(imgBytes: Uint8Array, prompt: string): Promise<Buffer> {
  const env = getServerEnv();
  const token = env.REPLICATE_API_TOKEN!;
  const model = env.REPLICATE_IMAGE_MODEL;
  const resized = await sharp(Buffer.from(imgBytes))
    .rotate()
    .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const dataUri = `data:image/jpeg;base64,${resized.toString("base64")}`;

  // POST with a couple of retries for the new-account rate limit (429).
  let body: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait" },
      body: JSON.stringify({
        input: { prompt, input_image: dataUri, aspect_ratio: "match_input_image", output_format: "jpg", safety_tolerance: 2 },
      }),
    });
    body = await res.json();
    if (res.status === 429) {
      await sleep(((body?.retry_after ?? 3) + 2) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`replicate ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    break;
  }

  // Poll if not already finished (Prefer: wait usually returns it complete).
  const getUrl = body?.urls?.get;
  for (let i = 0; i < 40 && body.status && body.status !== "succeeded"; i++) {
    if (body.status === "failed" || body.status === "canceled") throw new Error(`replicate ${body.status}`);
    await sleep(2000);
    body = await (await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } })).json();
  }
  let out = body.output;
  if (Array.isArray(out)) out = out[0];
  if (!out) throw new Error("replicate returned no output");
  const raw = Buffer.from(await (await fetch(out)).arrayBuffer());
  return normalizeExposure(raw);
}

/**
 * Gentle two-sided exposure safety net: only nudges the image when it's clearly
 * off — lifts genuinely dark results a little, pulls back genuinely blown-out
 * ones — aiming for a natural, balanced exposure (never pushing to extremes).
 */
async function normalizeExposure(buf: Buffer): Promise<Buffer> {
  try {
    const stats = await sharp(buf).stats();
    const rgb = stats.channels.slice(0, 3);
    const mean = rgb.reduce((a, c) => a + c.mean, 0) / (rgb.length || 1);
    let factor = 1;
    if (mean < 80) factor = Math.min(1.4, 95 / mean); // too dark → gentle lift
    else if (mean > 180) factor = Math.max(0.72, 155 / mean); // too bright → gentle pull-down
    if (Math.abs(factor - 1) < 0.03) return buf;
    return await sharp(buf).modulate({ brightness: factor }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    return buf;
  }
}

/**
 * Text-to-image generation (Replicate Flux Schnell by default): produce a clean,
 * photo-style image from a prompt when the client has no real photo for a slot.
 * Returns JPEG bytes, or null if generation is unavailable/failed.
 */
export async function generatePhotoImage(prompt: string, aspectRatio = "1:1"): Promise<Buffer | null> {
  const env = getServerEnv();
  const token = env.REPLICATE_API_TOKEN;
  if (!token) {
    console.error("generatePhotoImage: REPLICATE_API_TOKEN missing — cannot text-to-image");
    return null;
  }
  routeImageJob("photo_generate");
  const model = env.REPLICATE_TEXT_IMAGE_MODEL;
  try {
    let body: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait" },
        body: JSON.stringify({
          input: { prompt, aspect_ratio: aspectRatio, output_format: "jpg", num_outputs: 1 },
        }),
      });
      body = await res.json();
      if (res.status === 429) {
        await sleep(((body?.retry_after ?? 3) + 2) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`replicate ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
      break;
    }
    const getUrl = body?.urls?.get;
    for (let i = 0; i < 40 && body.status && body.status !== "succeeded"; i++) {
      if (body.status === "failed" || body.status === "canceled") throw new Error(`replicate ${body.status}`);
      await sleep(2000);
      body = await (await fetch(getUrl, { headers: { Authorization: `Bearer ${token}` } })).json();
    }
    let out = body.output;
    if (Array.isArray(out)) out = out[0];
    if (!out) throw new Error("replicate returned no output");
    const raw = Buffer.from(await (await fetch(out)).arrayBuffer());
    return sharp(raw).jpeg({ quality: 88 }).toBuffer();
  } catch (err) {
    console.error("generatePhotoImage failed", err);
    return null;
  }
}

/**
 * Style a client's photo and store the result as a new media asset. Returns the
 * new media id, or null if editing is disabled/unavailable (caller falls back to
 * the original photo).
 */
export async function editImageForBrand(
  brand: Brand,
  mediaId: string,
  request?: string,
  /** When set, skip LLM prompt generation and reuse this grade (photo-bundle consistency). */
  sharedPrompt?: string,
): Promise<string | null> {
  if (!getServerEnv().REPLICATE_API_TOKEN) return null;
  routeImageJob("photo_edit");
  const blob = await getMedia(mediaId);
  if (!blob || !blob.contentType.startsWith("image/")) return null;
  try {
    const prompt = sharedPrompt ?? (await generateEditPrompt(brand, blob.bytes, request));
    const edited = await replicateEdit(blob.bytes, prompt);
    const newId = randomUUID();
    await query(
      `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
       values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
      [newId, brand.id, newId],
    );
    await putMedia(newId, new Uint8Array(edited), "image/jpeg");
    return newId;
  } catch (err) {
    console.error(`editImageForBrand: failed for media ${mediaId}`, err);
    return null;
  }
}

/**
 * Grade every slide in a photo-bundle with one shared Flux prompt so the swipe
 * reads as one set (consistent colour/light). Cover may still get a text tile;
 * interior slides stay photo-only after the shared grade (styled cover + candid rest).
 */
export async function gradePhotoBundle(
  brand: Brand,
  mediaIds: string[],
  request?: string,
): Promise<string[]> {
  if (mediaIds.length === 0) return [];
  const first = await getMedia(mediaIds[0]!);
  if (!first || !first.contentType.startsWith("image/")) return mediaIds;
  let shared: string | undefined;
  try {
    shared = await generateEditPrompt(brand, first.bytes, request);
  } catch {
    shared = undefined;
  }
  const { mapWithConcurrency, SLIDE_RENDER_CONCURRENCY } = await import("./concurrency.js");
  const graded = await mapWithConcurrency(mediaIds, SLIDE_RENDER_CONCURRENCY, async (id) => {
    const edited = await editImageForBrand(brand, id, request, shared).catch(() => null);
    return edited ?? id;
  });
  return graded;
}

// ─── Text tile (Satori + resvg): burn a bold headline onto the image ─────────

/** Does the client's message ask for text on the image? */
export function messageWantsText(body: string | null | undefined): boolean {
  if (!body) return false;
  return /\b(text|caption on|words on|title on|headline|writing on|add text|put text|overlay)\b/i.test(body);
}

/** Explicit "no text on the image" / leave it clean. */
export function messageWantsNoText(body: string | null | undefined): boolean {
  if (!body) return false;
  return /\b(no text|without text|no headline|no overlay|don'?t add text|leave (it|the photo) (clean|alone|as is)|just the photo|candid)\b/i.test(
    body,
  );
}

/**
 * Smarter headline-on-photo default (Phase C1).
 * - Explicit ask → yes; explicit decline → no
 * - Business: yes when promo/offer language OR short/empty instruction
 * - Personal: only when asked
 * - Stories: overlay by default (unless declined)
 */
export function shouldOverlayHeadline(
  brand: Brand,
  body: string | null | undefined,
  opts?: { caption?: string; format?: "feed" | "carousel" | "story" | "reel" },
): boolean {
  if (messageWantsNoText(body)) return false;
  if (messageWantsText(body)) return true;
  if (opts?.format === "story") return true;
  // Reels: no automatic photo headline (video cover/text overlay is a separate path).
  if (opts?.format === "reel") return false;
  if (brand.account_type === "personal") return false;

  const text = `${body ?? ""} ${opts?.caption ?? ""}`;
  if (/\b(offer|sale|%\s*off|discount|menu|special|launch|new drop|book now|limited|promo|deal)\b/i.test(text)) {
    return true;
  }
  const trimmed = (body ?? "").trim();
  return trimmed.length < 48;
}

/** Crop/letterbox a photo into 9:16 story frame (safe for IG Stories). */
export async function frameStoryImage(imgBytes: Uint8Array): Promise<Buffer> {
  const width = 1080;
  const height = 1920;
  return sharp(Buffer.from(imgBytes))
    .rotate()
    .resize({ width, height, fit: "cover", position: "centre" })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/**
 * Does the client's follow-up ask to change the PHOTO (vs. the caption wording)?
 * Used on a pending draft to route "make it brighter" / "change the background"
 * to a re-edit of the image rather than a caption rewrite.
 */
export function messageWantsImageEdit(body: string | null | undefined): boolean {
  if (!body) return false;
  // Photo-background redos regenerate drafts — do not Flux-edit a text card.
  if (looksLikePhotoBackgroundAsk(body)) return false;
  return /\b(photo|image|picture|pic|background|bg|lighting|light|bright(er|en)?|dark(er|en)?|colou?r|filter|crop|contrast|saturat\w*|vibrant|warm(er)?|cool(er)?|cinematic|cine|vibe|blur|sharp(er|en)?|exposure|shadows?|highlights?|black\s*and\s*white|b&w|grade|grading|retouch|edit the (photo|image|pic|picture))\b/i.test(
    body,
  );
}

/** Write a short punchy ALL-CAPS overlay headline from the post caption. */
export async function generateHeadline(brand: Brand, caption: string): Promise<string> {
  const out = await callLLM({
    system:
      "Write a punchy 2-5 word ALL-CAPS headline to overlay on a social-media image. No quotes, no emoji, no hashtags, no full stop, no dashes. Just the words.",
    messages: [{ role: "user", content: `Brand: ${brand.name}. Post caption: "${caption}". Give the overlay headline.` }],
    maxTokens: 20,
  });
  return sanitizeChatText(out.replace(/["'.]/g, "")).toUpperCase().slice(0, 42) || brand.name.toUpperCase();
}

async function renderTile(
  imgBytes: Uint8Array,
  headline: string,
  masthead: string,
  visual?: VisualProfile | null,
): Promise<Buffer> {
  const palette = resolveBrandPalette(visual);
  const meta = await sharp(Buffer.from(imgBytes)).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1350;
  const jpeg = await sharp(Buffer.from(imgBytes)).jpeg({ quality: 90 }).toBuffer();
  const dataUri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const fontSize = Math.round(width * 0.085);
  const mastheadSize = Math.round(width * 0.062);
  const pad = Math.round(width * 0.05);
  const scrim = hexToRgb(palette.bgFrom);

  const svg = await satori(
    {
      type: "div",
      props: {
        style: { display: "flex", width: `${width}px`, height: `${height}px`, position: "relative" },
        children: [
          {
            type: "img",
            props: { src: dataUri, width, height, style: { position: "absolute", top: 0, left: 0, width: `${width}px`, height: `${height}px`, objectFit: "cover" } },
          },
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                top: 0,
                left: 0,
                width: `${width}px`,
                display: "flex",
                justifyContent: "center",
                padding: `${Math.round(height * 0.03)}px ${pad}px`,
                background: `linear-gradient(to bottom, rgba(${scrim.r},${scrim.g},${scrim.b},0.55), rgba(${scrim.r},${scrim.g},${scrim.b},0))`,
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      color: palette.text,
                      fontFamily: palette.bodyFont,
                      fontSize: `${mastheadSize}px`,
                      letterSpacing: "0.02em",
                      textAlign: "center",
                      lineHeight: 1.05,
                    },
                    children: masthead,
                  },
                },
              ],
            },
          },
          {
            type: "div",
            props: {
              style: {
                position: "absolute",
                bottom: 0,
                left: 0,
                width: `${width}px`,
                display: "flex",
                padding: `${pad}px`,
                background: `linear-gradient(to top, rgba(${scrim.r},${scrim.g},${scrim.b},0.85), rgba(${scrim.r},${scrim.g},${scrim.b},0))`,
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      display: "flex",
                      color: palette.text,
                      fontFamily: palette.displayFont,
                      fontSize: `${fontSize}px`,
                      lineHeight: 1.02,
                      textTransform: "uppercase",
                    },
                    children: headline,
                  },
                },
              ],
            },
          },
        ],
      },
    } as unknown as Parameters<typeof satori>[0],
    {
      width,
      height,
      fonts: [
        { name: "Anton", data: ANTON, weight: 400, style: "normal" },
        { name: "Playfair", data: SERIF, weight: 700, style: "normal" },
        { name: "Inter", data: INTER_REGULAR, weight: 400, style: "normal" },
        { name: "Inter", data: INTER_BOLD, weight: 700, style: "normal" },
      ],
    },
  );

  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return sharp(png).jpeg({ quality: 88 }).toBuffer();
}

/**
 * Render a branded text card (no photo). Uses VisualProfile colours/fonts when
 * present; otherwise a sensible dark default (not the only look forever).
 */
export async function renderQuoteCard(
  text: string,
  brandOrName: Brand | string,
  visualOverride?: VisualProfile | null,
): Promise<Buffer> {
  const brandName = typeof brandOrName === "string" ? brandOrName : brandOrName.name;
  const visual =
    visualOverride ?? (typeof brandOrName === "string" ? null : (brandOrName.visual ?? null));
  const palette = resolveBrandPalette(visual);

  const width = 1080;
  const height = 1080;
  const pad = Math.round(width * 0.11);
  const fontSize = Math.round(width * (text.length > 90 ? 0.058 : text.length > 50 ? 0.072 : 0.092));

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexDirection: "column",
          width: `${width}px`,
          height: `${height}px`,
          background: `linear-gradient(145deg, ${palette.bgFrom}, ${palette.bgTo})`,
          padding: `${pad}px`,
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        },
        children: [
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                color: palette.text,
                fontFamily: palette.bodyFont,
                fontSize: `${fontSize}px`,
                lineHeight: 1.2,
                letterSpacing: "0.01em",
              },
              children: text,
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                position: "absolute",
                bottom: `${pad}px`,
                color: palette.muted,
                fontFamily: palette.displayFont,
                fontSize: `${Math.round(width * 0.03)}px`,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              },
              children: brandName.toUpperCase(),
            },
          },
        ],
      },
    } as unknown as Parameters<typeof satori>[0],
    {
      width,
      height,
      fonts: [
        { name: "Anton", data: ANTON, weight: 400, style: "normal" },
        { name: "Playfair", data: SERIF, weight: 700, style: "normal" },
        { name: "Inter", data: INTER_REGULAR, weight: 400, style: "normal" },
        { name: "Inter", data: INTER_BOLD, weight: 700, style: "normal" },
      ],
    },
  );
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return sharp(png).jpeg({ quality: 88 }).toBuffer();
}

/** Overlay a headline on a stored image; store + return the new media id (or null). */
export async function applyTextTile(brand: Brand, mediaId: string, headline: string): Promise<string | null> {
  const blob = await getMedia(mediaId);
  if (!blob) return null;
  try {
    const tiled = await renderTile(blob.bytes, headline, brand.name.toUpperCase(), brand.visual);
    const newId = randomUUID();
    await query(
      `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
       values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
      [newId, brand.id, newId],
    );
    await putMedia(newId, new Uint8Array(tiled), "image/jpeg");
    return newId;
  } catch (err) {
    console.error(`applyTextTile: failed for media ${mediaId}`, err);
    return null;
  }
}

/**
 * Story-native creative: force 9:16 cover crop + optional overlay/CTA in the
 * vertical safe zone (kept off extreme top/bottom edges).
 */
export async function applyStoryCreative(
  brand: Brand,
  mediaId: string,
  overlay: string,
  cta?: string,
): Promise<string | null> {
  const blob = await getMedia(mediaId);
  if (!blob) return null;
  try {
    const framed = await frameStoryImage(blob.bytes);
    const width = 1080;
    const height = 1920;
    const safeTop = Math.round(height * 0.18);
    const safeBottom = Math.round(height * 0.78);
    const jpeg = await sharp(framed).jpeg({ quality: 90 }).toBuffer();
    const dataUri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    const palette = resolveBrandPalette(brand.visual);
    const scrim = hexToRgb(palette.bgFrom);
    const headline = overlay.toUpperCase().slice(0, 48);
    const ctaLine = (cta ?? "").trim().slice(0, 36);

    const svg = await satori(
      {
        type: "div",
        props: {
          style: { display: "flex", width: `${width}px`, height: `${height}px`, position: "relative" },
          children: [
            {
              type: "img",
              props: {
                src: dataUri,
                width,
                height,
                style: {
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: `${width}px`,
                  height: `${height}px`,
                  objectFit: "cover",
                },
              },
            },
            {
              type: "div",
              props: {
                style: {
                  position: "absolute",
                  top: `${safeTop}px`,
                  left: 0,
                  width: `${width}px`,
                  height: `${safeBottom - safeTop}px`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  padding: `0 ${Math.round(width * 0.08)}px ${Math.round(height * 0.04)}px`,
                  background: `linear-gradient(to top, rgba(${scrim.r},${scrim.g},${scrim.b},0.72), rgba(${scrim.r},${scrim.g},${scrim.b},0))`,
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        color: palette.text,
                        fontFamily: palette.displayFont,
                        fontSize: `${Math.round(width * 0.09)}px`,
                        lineHeight: 1.05,
                        textTransform: "uppercase",
                      },
                      children: headline,
                    },
                  },
                  ctaLine
                    ? {
                        type: "div",
                        props: {
                          style: {
                            display: "flex",
                            marginTop: `${Math.round(height * 0.02)}px`,
                            color: palette.muted,
                            fontFamily: palette.bodyFont,
                            fontSize: `${Math.round(width * 0.045)}px`,
                            letterSpacing: "0.04em",
                          },
                          children: ctaLine,
                        },
                      }
                    : null,
                ].filter(Boolean),
              },
            },
          ],
        },
      } as unknown as Parameters<typeof satori>[0],
      {
        width,
        height,
        fonts: [
          { name: "Anton", data: ANTON, weight: 400, style: "normal" },
          { name: "Playfair", data: SERIF, weight: 700, style: "normal" },
          { name: "Inter", data: INTER_REGULAR, weight: 400, style: "normal" },
          { name: "Inter", data: INTER_BOLD, weight: 700, style: "normal" },
        ],
      },
    );
    const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
    const out = await sharp(png).jpeg({ quality: 88 }).toBuffer();
    const newId = randomUUID();
    await query(
      `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
       values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
      [newId, brand.id, newId],
    );
    await putMedia(newId, new Uint8Array(out), "image/jpeg");
    return newId;
  } catch (err) {
    console.error(`applyStoryCreative: failed for media ${mediaId}`, err);
    return null;
  }
}
