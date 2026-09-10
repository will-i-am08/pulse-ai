import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { query, getMedia, putMedia, getServerEnv, sanitizeChatText, type Brand } from "@pulse/shared";
import { callLLM } from "./llm.js";
// Fonts are embedded as base64 (see scripts/embed-fonts.ts) so they load the same
// in the Next serverless bundle and the worker — no file tracing / path issues.
import { anton as ANTON, serif as SERIF } from "./assets/fonts.generated.js";

// AI image editing via Replicate (Flux Kontext by default). The agent writes a
// tailored edit instruction from the actual photo + brand, then runs the model.
// Business = truthful (keep the real subject, improve it); personal = bolder.

type ContentPart = Exclude<Anthropic.MessageParam["content"], string>[number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vision LLM: given the photo + brand (+ the client's own request), write a Flux Kontext edit instruction. */
async function generateEditPrompt(brand: Brand, imgBytes: Uint8Array, request?: string): Promise<string> {
  const business = brand.account_type !== "personal";
  // Strip any "add text" intent — text is burned on deterministically by the tile,
  // never by the image model (whose text comes out mangled).
  const asked0 = (request ?? "")
    .replace(/\b(with\s+)?(text|a\s+caption|caption|words|a\s+title|title|a\s+headline|headline|writing)\b(\s+on(\s+(it|the\s+\w+))?)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const asked = asked0.length > 2 ? asked0 : "";
  const system = [
    "You write ONE vivid image-editing instruction for the Flux Kontext model that turns a client's phone photo into a scroll-stopping social-media image. The change must be clearly visible and worth it — a real transformation, never a timid touch-up.",
    business
      ? "BUSINESS account: keep the real subject/product/place truthful, but make it look genuinely professionally shot — strong clean studio-grade lighting, rich true colour, tidy background, polished composition."
      : "PERSONAL/creator account: go bold and cinematic — dramatic directional lighting, rich contrast and a strong colour grade, striking and high-energy — while keeping the subject clearly recognisable.",
    asked ? `MOST IMPORTANT — the client specifically asked for: "${asked}". Honour that request above everything else.` : "",
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
  if (!token) return null;
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
export async function editImageForBrand(brand: Brand, mediaId: string, request?: string): Promise<string | null> {
  if (!getServerEnv().REPLICATE_API_TOKEN) return null;
  const blob = await getMedia(mediaId);
  if (!blob || !blob.contentType.startsWith("image/")) return null;
  try {
    const prompt = await generateEditPrompt(brand, blob.bytes, request);
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

// ─── Text tile (Satori + resvg): burn a bold headline onto the image ─────────

/** Does the client's message ask for text on the image? */
export function messageWantsText(body: string | null | undefined): boolean {
  if (!body) return false;
  return /\b(text|caption on|words on|title on|headline|writing on)\b/i.test(body);
}

/**
 * Does the client's follow-up ask to change the PHOTO (vs. the caption wording)?
 * Used on a pending draft to route "make it brighter" / "change the background"
 * to a re-edit of the image rather than a caption rewrite.
 */
export function messageWantsImageEdit(body: string | null | undefined): boolean {
  if (!body) return false;
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

async function renderTile(imgBytes: Uint8Array, headline: string, masthead: string): Promise<Buffer> {
  const meta = await sharp(Buffer.from(imgBytes)).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1350;
  const jpeg = await sharp(Buffer.from(imgBytes)).jpeg({ quality: 90 }).toBuffer();
  const dataUri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const fontSize = Math.round(width * 0.085);
  const mastheadSize = Math.round(width * 0.062);
  const pad = Math.round(width * 0.05);

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
              style: { position: "absolute", top: 0, left: 0, width: `${width}px`, display: "flex", justifyContent: "center", padding: `${Math.round(height * 0.03)}px ${pad}px`, background: "linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0))" },
              children: [
                { type: "div", props: { style: { display: "flex", color: "white", fontFamily: "Playfair", fontSize: `${mastheadSize}px`, letterSpacing: "0.02em", textAlign: "center", lineHeight: 1.05 }, children: masthead } },
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
                background: "linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0))",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: { display: "flex", color: "white", fontFamily: "Anton", fontSize: `${fontSize}px`, lineHeight: 1.02, textTransform: "uppercase" },
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
      ],
    },
  );

  const png = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  return sharp(png).jpeg({ quality: 88 }).toBuffer();
}

/**
 * Render a branded text card (no photo) for a generated filler post — a dark
 * canvas with a centred serif line and the brand name beneath.
 */
export async function renderQuoteCard(text: string, brandName: string): Promise<Buffer> {
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
          background: "linear-gradient(145deg, #141414, #2a2a2a)",
          padding: `${pad}px`,
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        },
        children: [
          {
            type: "div",
            props: {
              style: { display: "flex", color: "#ffffff", fontFamily: "Playfair", fontSize: `${fontSize}px`, lineHeight: 1.2, letterSpacing: "0.01em" },
              children: text,
            },
          },
          {
            type: "div",
            props: {
              style: { display: "flex", position: "absolute", bottom: `${pad}px`, color: "rgba(255,255,255,0.75)", fontFamily: "Anton", fontSize: `${Math.round(width * 0.03)}px`, letterSpacing: "0.12em", textTransform: "uppercase" },
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
    const tiled = await renderTile(blob.bytes, headline, brand.name.toUpperCase());
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
