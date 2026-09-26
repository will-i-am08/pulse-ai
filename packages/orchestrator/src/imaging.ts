import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import {
  query,
  queryOne,
  getMedia,
  putMedia,
  getServerEnv,
  sanitizeChatText,
  brandVoiceProfileSchema,
  type Brand,
  type VisualProfile,
} from "@pulse/shared";
import { callLLM } from "./llm.js";
import { routeImageJob, stillChainForQuality, type CreativeQuality } from "./modelRouter.js";
import { assertAiSpendAllowed, recordAiSpend } from "./aiSpend.js";
import {
  overlayMasthead,
  isNamelessCreative,
  stripPersonalNames,
  creativeBrandLabel,
  creativeSceneConstraint,
  labSafeVisualBit,
} from "./faceless.js";
import { PHOTO_EDIT_FAITHFUL_PROHIBITION } from "./lookPacks/index.js";
// Fonts are embedded as base64 (see scripts/embed-fonts.ts) so they load the same
// in the Next serverless bundle and the worker — no file tracing / path issues.
import { anton as ANTON, serif as SERIF, interRegular as INTER_REGULAR, interBold as INTER_BOLD } from "./assets/fonts.generated.js";
import { looksLikePhotoBackgroundAsk } from "./visualMode.js";
import { safePublicUrl } from "./research.js";
import { resolveBrandDecoKit, isIdentityDecoPiece, type DecoPiece, type FeedElementsMode } from "./brandElements.js";
import { compositeBrandDecoration, pickDecoPaint, samplePhotoLuminance } from "./brandDecoration.js";

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
  ].filter((b): b is string => typeof b === "string" && labSafeVisualBit(b, brand));
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
    business
      ? "You write ONE image-editing instruction for the Flux Kontext model that faithfully polishes a client's phone photo. Prefer a faithful polish — lighting, colour, sharpness, tidiness — not a restaged scene. Keep the phone-shot character (slight grain, handheld crop) unless the request or brand photo_style asks for a more professional grade."
      : "You write ONE vivid image-editing instruction for the Flux Kontext model that turns a client's phone photo into a scroll-stopping social-media image. The change must be clearly visible and worth it — a real transformation, never a timid touch-up. Still read as a real phone photo, not CGI, unless their photo_style or this request asks for a more produced look.",
    business
      ? "BUSINESS account — FAITHFUL POLISH: keep the real subject/product/premises truthful and recognisable. Improve lighting, colour fidelity, and tidiness while keeping iPhone grain and handheld framing. Do not studio-polish into a glossy ad unless the client request or brand visual/photo_style asks for a more professional grade. Do NOT reinvent, replace, restage, or misrepresent the product, place, or people. No fantasy props, no fake packaging, no relocated storefront, no invented tools or vehicles."
      : "PERSONAL/creator account: stronger light and colour are fine when their voice asks for it — keep the subject clearly recognisable and default to a real phone photo, not a 3D render.",
    styleBits.length ? `Brand visual + photo_style direction: ${styleBits.join("; ")}.` : "",
    asked
      ? `Client request (lighting/grade/crop hint only — never restage or invent subjects): "${asked}".`
      : "",
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
    { type: "text", text: `Brand: "${creativeBrandLabel(brand)}". Write the single edit instruction now.` },
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

/** A brand identity thin enough for every image caller to supply. */
export type SpendBrand = Pick<Brand, "id" | "facts">;

/**
 * Is this brand over the weekly AI spend cap for one more image?
 *
 * Reads facts fresh from the DB: callers hold a Brand loaded at the top of the
 * request, so a 10-photo bundle would otherwise check the same stale $0.00 ten
 * times and sail past the cap.
 */
async function imageSpendBlocked(brand: SpendBrand): Promise<boolean> {
  let facts = brand.facts;
  try {
    const fresh = await queryOne<Brand>(`select facts from brands where id = $1`, [brand.id]);
    if (fresh) facts = fresh.facts;
  } catch {
    /* fall back to the caller's snapshot */
  }
  const blocked = assertAiSpendAllowed({ facts }, "image");
  if (blocked) {
    console.warn(
      JSON.stringify({ evt: "image_spend_capped", brand_id: brand.id, reason: "weekly_cap" }),
    );
    return true;
  }
  return false;
}

/**
 * Text-to-image for feed drafts. Prefers the fal still router (Nano Banana →
 * Flux Dev → Seedream) used by UGC — better realism + negatives than bare
 * Flux Schnell on Replicate. Falls back to Replicate when fal is unset/fails.
 * Image edits of real uploads still use Replicate Kontext via editImageForBrand.
 * Optional `opts.quality` selects the still chain (default: standard).
 */
export async function generatePhotoImage(
  prompt: string,
  aspectRatio = "1:1",
  opts?: {
    quality?: CreativeQuality;
    brief?: string;
    /** Pass the brand so the generation is counted against AI_WEEKLY_SPEND_CAP_USD. */
    brand?: SpendBrand | null;
    /**
     * Pin the fal still chain (e.g. `["nano_banana"]`) so Lab photo carousels
     * don't cascade into flux_dev after an empty nano result and blow the 300s
     * after() budget.
     */
    stillIds?: string[];
  },
): Promise<Buffer | null> {
  routeImageJob("photo_generate");
  const ratio = aspectRatio.includes(":") ? aspectRatio : "1:1";
  const quality: CreativeQuality = opts?.quality ?? "standard";
  const brand = opts?.brand ?? null;

  if (brand) {
    if (await imageSpendBlocked(brand)) return null;
  } else {
    console.warn(
      JSON.stringify({ evt: "image_spend_uncapped", fn: "generatePhotoImage", reason: "no_brand" }),
    );
  }

  const scene = brand ? creativeSceneConstraint(brand) : "";
  const fullPrompt = [prompt, scene].filter(Boolean).join(". ");
  const buf = await generatePhotoImageInner(fullPrompt, ratio, quality, opts?.brief, opts?.stillIds);
  if (buf && brand) await recordAiSpend(brand.id, "image").catch(() => {});
  return buf;
}

async function generatePhotoImageInner(
  prompt: string,
  ratio: string,
  quality: CreativeQuality = "standard",
  brief?: string,
  stillIds?: string[],
): Promise<Buffer | null> {
  try {
    const { falConfigured, falGenerateImageRouted } = await import("./ugc/falClient.js");
    const { resolveStillChain } = await import("./ugc/modelRouter.js");
    const { FEED_PHOTO_NEGATIVE, withFeedPhotoLook } = await import("./ugc/presets/stillPresets.js");
    prompt = withFeedPhotoLook(prompt);
    if (falConfigured()) {
      const chain = resolveStillChain(stillIds?.length ? stillIds : stillChainForQuality(quality, brief));
      const routed = await falGenerateImageRouted({
        prompt,
        aspectRatio: ratio,
        negativePrompt: FEED_PHOTO_NEGATIVE,
        chain,
      });
      if (routed?.buffer?.length) {
        console.info(
          JSON.stringify({
            evt: "feed_photo_fal",
            modelId: routed.modelId,
            falId: routed.falId,
            quality,
          }),
        );
        return sharp(routed.buffer).jpeg({ quality: 88 }).toBuffer();
      }
    }
  } catch (err) {
    console.warn("generatePhotoImage: fal still router failed, trying Replicate", err);
  }

  return generatePhotoImageViaReplicate(prompt, ratio);
}

/** Replicate Flux Schnell fallback when fal is unavailable. */
async function generatePhotoImageViaReplicate(
  prompt: string,
  aspectRatio: string,
): Promise<Buffer | null> {
  const env = getServerEnv();
  const token = env.REPLICATE_API_TOKEN;
  if (!token) {
    console.error("generatePhotoImage: no FAL_KEY and REPLICATE_API_TOKEN missing — cannot text-to-image");
    return null;
  }
  const model = env.REPLICATE_TEXT_IMAGE_MODEL;
  // Schnell has no negative_prompt — bake realism + anti-slop into the prompt.
  let hardened = prompt;
  try {
    const { FEED_PHOTO_NEGATIVE, withFeedPhotoLook } = await import("./ugc/presets/stillPresets.js");
    const avoid = FEED_PHOTO_NEGATIVE.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 24).join(", ");
    hardened = [withFeedPhotoLook(prompt), avoid ? `Avoid: ${avoid}` : ""]
      .filter(Boolean)
      .join(". ");
  } catch {
    /* presets optional */
  }
  try {
    let body: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait" },
        body: JSON.stringify({
          input: { prompt: hardened, aspect_ratio: aspectRatio, output_format: "jpg", num_outputs: 1 },
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
    console.error("generatePhotoImage Replicate failed", err);
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
  opts?: { mode?: "variant" | "creative" },
): Promise<string | null> {
  if (!getServerEnv().REPLICATE_API_TOKEN) return null;
  routeImageJob("photo_edit");
  const blob = await getMedia(mediaId);
  if (!blob || !blob.contentType.startsWith("image/")) return null;
  // Checked BEFORE the vision call: the LLM prompt is billable too, and the
  // caller falls back to the original photo when this returns null.
  if (await imageSpendBlocked(brand)) return null;
  try {
    let prompt: string;
    if (opts?.mode === "variant") {
      // Look-picker: use the faithful grade/crop request verbatim. Never run
      // generateEditPrompt (that injects brand/trade scene constraints).
      const req = (request ?? "").trim();
      prompt = req.includes(PHOTO_EDIT_FAITHFUL_PROHIBITION)
        ? req
        : [req, PHOTO_EDIT_FAITHFUL_PROHIBITION].filter(Boolean).join(" ");
    } else {
      prompt = sharedPrompt ?? (await generateEditPrompt(brand, blob.bytes, request));
    }
    const edited = await replicateEdit(blob.bytes, prompt);
    await recordAiSpend(brand.id, "image").catch(() => {});
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
  // One check up front so a capped brand doesn't pay for the shared vision call
  // either; the per-photo edits are capped again inside editImageForBrand.
  if (await imageSpendBlocked(brand)) return mediaIds;
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

/** Explicit "no text on the image" / leave it clean / strip overlay. */
export function messageWantsNoText(body: string | null | undefined): boolean {
  if (!body) return false;
  const t = body.trim();
  if (
    /\b(no text|without text|no headline|no overlay|don'?t add text|leave (it|the photo) (clean|alone|as is)|just the photo|candid)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // "Remove the text", "take the text off the image"
  if (
    /\b(remove|strip|drop|delete|take off|clear)\b.{0,28}\b(text|words|headline|overlay|writing|type)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(text|words|headline|overlay)\b.{0,20}\b(off|from)\b.{0,12}\b(the\s+)?(image|photo|pic|picture)\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Owner is asking to strip overlay on the *current* pending draft — not briefing a
 * new creative ("no text, just good looking bread").
 */
export function messageWantsStripPendingOverlay(body: string | null | undefined): boolean {
  if (!body) return false;
  const t = body.trim();
  // New creative brief that includes a no-text preference — not a pending strip.
  if (
    /\b(make|draft|create|generate|carousel|charasel|post about|knock (up|out))\b/i.test(t) &&
    !/\b(remove|strip|take off|clear)\b/i.test(t)
  ) {
    return false;
  }
  if (
    /\b(remove|strip|drop|delete|take off|clear)\b.{0,28}\b(text|words|headline|overlay|writing)\b/i.test(t)
  ) {
    return true;
  }
  if (/\b(no text|without text|text off)\b.{0,24}\b(on|from)\s+(the\s+)?(image|photo|pic|picture|overlay)\b/i.test(t)) {
    return true;
  }
  if (/^(no text|without text|text off|remove the text)\s*[!.?]*$/i.test(t)) return true;
  return false;
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

export const OVERLAY_HEADLINE_MAX_WORDS = 5;
export const OVERLAY_HEADLINE_MAX_CHARS = 28;

/** Trailing function words the overlay cap must never leave dangling. */
export const OVERLAY_TRAILING_FUNCTION_WORDS = new Set([
  "THE",
  "A",
  "AN",
  "AND",
  "OR",
  "OF",
  "TO",
  "FOR",
  "WITH",
  "NOT",
  "IN",
  "ON",
  "AT",
  "BY",
  "FROM",
  "INTO",
  "OVER",
  "UNDER",
  "UP",
  "AS",
  "IS",
  "ARE",
  "BE",
  "WAS",
  "WERE",
]);

/**
 * Interior fillers dropped when a cleaned overlay has more than 5 words, so
 * content words survive instead of a first-N slice of a longer clause.
 * Phrasal particles (UP/OVER/UNDER) stay — they are often part of the phrase.
 * Quantifiers like EVERY stay interior so a later trailing strip can complete
 * the headline (FLOSS … MISSES EVERY → MISSES) instead of skipping to SINGLE.
 */
const OVERLAY_INTERIOR_FILLER_WORDS = new Set([
  "THE",
  "A",
  "AN",
  "AND",
  "OR",
  "OF",
  "TO",
  "FOR",
  "WITH",
  "NOT",
  "IN",
  "ON",
  "AT",
  "BY",
  "FROM",
  "YOUR",
  "MY",
  "OUR",
  "ITS",
  "IS",
  "ARE",
  "WAS",
  "WERE",
  "BE",
  "BEEN",
  "BEING",
  "THAT",
  "THIS",
  "THESE",
  "THOSE",
  "WHO",
  "WHICH",
  "WHAT",
  "THEY",
  "THEM",
  "WE",
  "YOU",
  "I",
  "ME",
  "HE",
  "SHE",
  "IT",
  "THEIR",
  "HIS",
  "HER",
  "WHEN",
  "IF",
  "WHILE",
  "BECAUSE",
  "HOW",
  "WHY",
  "WHERE",
  "VERY",
  "OTHERWISE",
]);

/**
 * Extra trailing leftovers a first-N cap of a longer sentence can still leave
 * after filler drop (EVERY/THAT/YOU/ABOVE). Only applied when we compressed.
 * Short headlines like LOVE YOU / RISE ABOVE are left alone.
 */
const OVERLAY_COMPRESS_DANGLE_WORDS = new Set([
  ...OVERLAY_TRAILING_FUNCTION_WORDS,
  "THAT",
  "THIS",
  "THESE",
  "THOSE",
  "EVERY",
  "EACH",
  "ANY",
  "SOME",
  "ALL",
  "BOTH",
  "SUCH",
  "YOU",
  "WE",
  "THEY",
  "THEM",
  "HE",
  "SHE",
  "IT",
  "ME",
  "US",
  "I",
  "HIM",
  "HER",
  "WHO",
  "WHOM",
  "WHICH",
  "WHAT",
  "WHOSE",
  "WHEN",
  "IF",
  "WHILE",
  "BECAUSE",
  "ALTHOUGH",
  "THOUGH",
  "UNLESS",
  "UNTIL",
  "SINCE",
  "WHETHER",
  "WHERE",
  "WHY",
  "HOW",
  "ABOVE",
  "BELOW",
  "BEFORE",
  "AFTER",
  "BETWEEN",
  "THROUGH",
  "DURING",
  "WITHOUT",
  "WITHIN",
  "ACROSS",
  "AGAINST",
  "AMONG",
  "AROUND",
  "BEHIND",
  "BESIDE",
  "BEYOND",
  "ABOUT",
  "VERY",
  "TOO",
  "JUST",
  "ALSO",
  "THEN",
  "THAN",
  "SO",
  "EVEN",
  "YET",
  "WAY",
  "SHOULD",
  "WOULD",
  "COULD",
  "WILL",
  "CAN",
  "MAY",
  "MIGHT",
  "MUST",
  "DO",
  "DOES",
  "DID",
  "HAVE",
  "HAS",
  "HAD",
  "BEEN",
  "BEING",
  "GET",
  "GOT",
  "OTHERWISE",
]);

/**
 * Period / ordinal adjectives that need a following noun. Char-cap must not
 * leave "SCHEDULE YOUR DOGS ANNUAL" after dropping VACCINATION.
 */
const OVERLAY_DANGLING_MODIFIERS = new Set([
  "ANNUAL",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
  "NEXT",
  "LAST",
  "FIRST",
  // Char-cap of a longer clause must not leave "WHAT FOUNDER OPS ACTUALLY".
  "ACTUALLY",
  "REALLY",
  "LITERALLY",
  "BASICALLY",
  "ESSENTIALLY",
  "SIMPLY",
  "NEARLY",
  "ALMOST",
  "QUITE",
  "RATHER",
  "TRULY",
  "ONLY",
  "STILL",
]);

/**
 * Restore common contractions the LLM omitted (or that a crude strip ate).
 * Only safe, high-signal overlays — not every WERE→WE'RE.
 */
const OVERLAY_CONTRACTION_REPAIRS: Array<[RegExp, string]> = [
  [/\bWERE HIRING\b/g, "WE'RE HIRING"],
  [/\bWERE OPEN\b/g, "WE'RE OPEN"],
  [/\bWERE LIVE\b/g, "WE'RE LIVE"],
  [/\bWERE BACK\b/g, "WE'RE BACK"],
  [/\bITS TIME\b/g, "IT'S TIME"],
  [/\bLETS\b/g, "LET'S"],
  [/\bDONT\b/g, "DON'T"],
  [/\bWONT\b/g, "WON'T"],
  [/\bCANT\b/g, "CAN'T"],
  [/\bYOURE\b/g, "YOU'RE"],
  [/\bTHEYRE\b/g, "THEY'RE"],
  [/\bIM\b/g, "I'M"],
];

function repairOverlayContractions(text: string): string {
  let out = text;
  for (const [re, to] of OVERLAY_CONTRACTION_REPAIRS) out = out.replace(re, to);
  return out;
}
function isOverlayPossessive(word: string): boolean {
  return /[A-Z0-9]+'S$/i.test(word);
}

function popTrailingOverlayWords(words: string[], stop: Set<string>): void {
  while (words.length > 1 && stop.has(words[words.length - 1]!)) {
    words.pop();
  }
}

/** After a cap, drop leftover adjectives and possessives that lost their noun. */
function popTrailingOverlayModifiers(words: string[]): void {
  let poppedOwned = false;
  while (words.length > 1) {
    const last = words[words.length - 1]!;
    if (OVERLAY_DANGLING_MODIFIERS.has(last) || isOverlayPossessive(last)) {
      poppedOwned = true;
      words.pop();
      continue;
    }
    if (poppedOwned && /^(YOUR|MY|OUR|ITS|THEIR|HIS|HER)$/.test(last)) {
      words.pop();
      continue;
    }
    break;
  }
}

/** Prefer dropping an interior filler/modifier over the last content noun. */
function dropInteriorForCharFit(words: string[]): boolean {
  for (let i = words.length - 2; i >= 1; i--) {
    const w = words[i]!;
    if (OVERLAY_INTERIOR_FILLER_WORDS.has(w) || OVERLAY_DANGLING_MODIFIERS.has(w)) {
      words.splice(i, 1);
      return true;
    }
  }
  return false;
}

/** Clean overlay copy: keep % ° and possessive/contraction apostrophes; drop other punctuation. */
function cleanOverlayText(text: string): string {
  let s = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00BA]/g, "°")
    .replace(/"/g, "");
  s = s.replace(/[^a-zA-Z0-9%'°\s]/g, " ");
  // Bare quotes / leading-trailing apostrophes, not DOG'S / WORLD'S / WE'RE.
  s = s.replace(/(^|[^A-Za-z0-9])'+|'+(?![A-Za-z])/g, "$1");
  s = s.replace(/\s+/g, " ").trim().toUpperCase();
  return repairOverlayContractions(s);
}

/**
 * Owner named an exact overlay to burn — pull it out of the brief so fillers
 * do not invent a shorter substitute (LAB-004).
 *
 * Matches: "exact overlay headline …: WHAT FOUNDER OPS ACTUALLY DOES",
 * quoted forms, and "saying/titled …" forms.
 */
export function extractExactOverlayHeadline(ask: string | null | undefined): string | null {
  const t = (ask ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;

  const patterns: RegExp[] = [
    /\bexact(?:ly)?\s+overlay\s+headline(?:\s+burned\s+on(?:\s+the)?\s+image)?\s*:\s*["']?([A-Z0-9][A-Z0-9'°%\s]{1,60}?)["']?(?=\s*$|\s*[—\-.]|\s+COMPLIANCE)/i,
    /\b(?:overlay\s+)?headline\s+(?:exactly\s+)?(?:burned\s+on(?:\s+the)?\s+image\s*)?:\s*["']?([A-Z0-9][A-Z0-9'°%\s]{1,60}?)["']?(?=\s*$|\s*[—\-.]|\s+COMPLIANCE)/i,
    /\b(?:with|burn)\s+(?:this\s+)?exact\s+overlay(?:\s+headline)?\s*:\s*["']?([A-Z0-9][A-Z0-9'°%\s]{1,60}?)["']?(?=\s*$|\s*[—\-.]|\s+COMPLIANCE)/i,
    /\b(?:saying|titled|title)\s*:\s*["']([^"']{2,80})["']/i,
    /\b(?:saying|titled)\s+["']([^"']{2,80})["']/i,
    /\bexact(?:ly)?\s+(?:overlay\s+)?(?:headline|text)\s+["']([^"']{2,80})["']/i,
    /\boverlay(?:\s+headline|\s+text)?\s+["']([^"']{2,80})["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    const raw = m?.[1]?.trim();
    if (!raw) continue;
    const cleaned = cleanOverlayText(raw);
    const words = cleaned.split(" ").filter(Boolean);
    if (words.length < 1 || words.length > 12) continue;
    if (cleaned.length < 2 || cleaned.length > 72) continue;
    // Reject if we accidentally captured instruction fluff.
    if (/\b(BURNED|CAROUSEL|GRAPHIC|IMAGE|PLEASE|MAKE)\b/.test(cleaned) && words.length <= 3) {
      continue;
    }
    return cleaned;
  }
  return null;
}

/** Clean + uppercase only — no 5-word / 28-char smash for owner-exact overlays. */
export function formatExactOverlayHeadline(text: string): string {
  return cleanOverlayText(text);
}

/** Drop interior fillers; keep the first and last tokens. */
function dropInteriorOverlayFillers(words: string[]): string[] {
  if (words.length <= 2) return words;
  const first = words[0]!;
  const last = words[words.length - 1]!;
  const interior = words.slice(1, -1).filter((w) => !OVERLAY_INTERIOR_FILLER_WORDS.has(w));
  return [first, ...interior, last];
}

/** Hard-cap overlay titles so they cannot smash in a 4:5 / MMS crop. */
export function formatOverlayHeadline(text: string): string {
  const cleaned = cleanOverlayText(text);
  let words = cleaned.split(" ").filter(Boolean);
  const compressed = words.length > OVERLAY_HEADLINE_MAX_WORDS;
  if (compressed) {
    words = dropInteriorOverlayFillers(words);
  }
  words = words.slice(0, OVERLAY_HEADLINE_MAX_WORDS);
  // Char-cap (e.g. dropping ACTUALLY) can leave auxiliaries like DOES — same
  // trail set as word-compression, not the short-headline-safe function set.
  let charCapped = false;
  const trailStop = () =>
    compressed || charCapped ? OVERLAY_COMPRESS_DANGLE_WORDS : OVERLAY_TRAILING_FUNCTION_WORDS;
  const stripTrail = () => {
    const stop = trailStop();
    popTrailingOverlayWords(words, stop);
    popTrailingOverlayModifiers(words);
    popTrailingOverlayWords(words, stop);
  };
  const fitWords = () => {
    let joined = words.join(" ");
    while (joined.length > OVERLAY_HEADLINE_MAX_CHARS && words.length > 1) {
      charCapped = true;
      if (!dropInteriorForCharFit(words)) words.pop();
      joined = words.join(" ");
    }
    return joined;
  };
  // Char-cap can expose a new trailing function word or dangling adjective.
  fitWords();
  stripTrail();
  let out = fitWords();
  stripTrail();
  out = words.join(" ");
  if (out.length > OVERLAY_HEADLINE_MAX_CHARS) {
    charCapped = true;
    const cutMidWord = out[OVERLAY_HEADLINE_MAX_CHARS] !== " ";
    const sliced = out.slice(0, OVERLAY_HEADLINE_MAX_CHARS).trim().split(" ").filter(Boolean);
    if (cutMidWord && sliced.length > 1) sliced.pop();
    const stop = trailStop();
    popTrailingOverlayWords(sliced, stop);
    popTrailingOverlayModifiers(sliced);
    popTrailingOverlayWords(sliced, stop);
    out = sliced.join(" ");
  }
  return repairOverlayContractions(out);
}

const OVERLAY_TITLE_SMALL = new Set(["A", "AN", "THE", "AND", "OR", "OF", "TO", "IN", "ON", "FOR", "VS", "AT"]);

function titleCaseOverlayWord(word: string, index: number, last: boolean): string {
  const core = word.replace(/'/g, "");
  if (index > 0 && !last && OVERLAY_TITLE_SMALL.has(core)) return word.toLowerCase();
  const parts = word.split("'");
  return parts
    .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p))
    .join("'");
}

/** Recase an already-cleaned (uppercase) overlay line. Does not smash length. */
export function applyOverlayCase(text: string, mode: OverlayCase = "upper"): string {
  if (mode === "upper") return text;
  return text
    .split("\n")
    .map((line) => {
      const words = line.split(" ").filter(Boolean);
      if (!words.length) return "";
      if (mode === "sentence") {
        return words
          .map((w, i) => (i === 0 ? titleCaseOverlayWord(w, 0, true) : w.toLowerCase()))
          .join(" ");
      }
      return words.map((w, i) => titleCaseOverlayWord(w, i, i === words.length - 1)).join(" ");
    })
    .join("\n");
}

export type OverlayPlacement = "bottom" | "top" | "center" | "low_left" | "chip";
export type OverlayStack = "single" | "stack";
export type OverlayFace = "inter" | "anton" | "playfair";
/** How words break across lines. Poster is the pilates one-word stack; pair/banner keep phrases together. */
export type OverlayWrap = "banner" | "pair" | "poster";
export type OverlayCase = "upper" | "title" | "sentence";

export type OverlayTreatment = {
  placement: OverlayPlacement;
  stack: OverlayStack;
  face: OverlayFace;
  wrap?: OverlayWrap;
  /** Default upper (legacy shouty). Quiet sans is title; editorial is sentence. */
  textCase?: OverlayCase;
  /** CSS em tracking, e.g. "0.08em". */
  letterSpacing?: string;
  /** Hairline under the headline — editorial / graphic quiet. */
  rule?: boolean;
};

/** Default photo overlay: stacked Anton, smack in the middle, two-line phrases. */
export const DEFAULT_OVERLAY_TREATMENT: OverlayTreatment = {
  placement: "center",
  stack: "stack",
  face: "anton",
  wrap: "pair",
};

/** Carousel / unsigned asks rotate through these so slides are not all one band. */
export const OVERLAY_STYLE_CYCLE: OverlayPlacement[] = ["center", "top", "bottom"];

/** Line-break recipes so every slide is not one-word-per-line. */
export const OVERLAY_WRAP_CYCLE: OverlayWrap[] = ["pair", "banner", "poster"];

export function cycleOverlayPlacement(slideIndex = 0): OverlayPlacement {
  const i = Number.isFinite(slideIndex) ? Math.max(0, Math.floor(slideIndex)) : 0;
  return OVERLAY_STYLE_CYCLE[i % OVERLAY_STYLE_CYCLE.length]!;
}

export function cycleOverlayWrap(slideIndex = 0): OverlayWrap {
  const i = Number.isFinite(slideIndex) ? Math.max(0, Math.floor(slideIndex)) : 0;
  return OVERLAY_WRAP_CYCLE[i % OVERLAY_WRAP_CYCLE.length]!;
}

function overlayWantsDisplayFace(visual?: VisualProfile | null): boolean {
  const fonts = (visual?.fonts ?? []).map((f) => f.toLowerCase());
  // Serif wins so "Playfair Display" stays Playfair, not Anton.
  if (fonts.some((f) => /serif|playfair|georgia|garamond|times|didot|bodoni|editorial/.test(f))) {
    return false;
  }
  return fonts.some((f) => /anton|impact|bebas|display|condensed|oswald|archivo black/.test(f));
}

/** Map stored visual.fonts onto a burnable face. Empty tokens stay Anton for shouty type. */
export function overlayFaceFromVisual(
  visual?: VisualProfile | null,
  opts?: { ideaBlurb?: boolean; mixedFonts?: boolean },
): OverlayFace {
  if (opts?.ideaBlurb || opts?.mixedFonts) return "anton";
  const fonts = (visual?.fonts ?? []).map((f) => f.toLowerCase());
  if (fonts.some((f) => /serif|playfair|georgia|garamond|times|didot|bodoni|editorial/.test(f))) {
    return "playfair";
  }
  if (overlayWantsDisplayFace(visual)) return "anton";
  if (
    fonts.some((f) =>
      /sans|helvetica|arial|montserrat|inter|futura|gothic|roboto|open sans|lato|poppins|dm sans|neue|linear/.test(
        f,
      ),
    )
  ) {
    return "inter";
  }
  return "anton";
}

function overlayFaceFromContext(
  visual?: VisualProfile | null,
  opts?: { ideaBlurb?: boolean; mixedFonts?: boolean },
): OverlayFace {
  return overlayFaceFromVisual(visual, opts);
}

/**
 * Deterministic overlay recipe from the owner's ask + site fonts.
 * No extra LLM. Explicit clean-photo asks are gated by shouldOverlayHeadline.
 */
export function inferOverlayTreatment(
  ask: string | null | undefined,
  visual?: VisualProfile | null,
  opts?: { ideaBlurb?: boolean; mixedFonts?: boolean; slideIndex?: number },
): OverlayTreatment {
  const text = (ask ?? "").replace(/\s+/g, " ").trim();
  const faceDefault = overlayFaceFromContext(visual, opts);

  if (
    /\b(designed tip(?: slide)?|tip slide|text card(?: on (?:a |the )?photo)?|big stacked type|stacked type|stacked text|stacked headline)\b/i.test(
      text,
    )
  ) {
    return { placement: "center", stack: "stack", face: "anton", wrap: "poster" };
  }

  if (
    /\b(in the middle|smack bang|dead cent(?:er|re)|cent(?:er|re)(?:ed)? (?:text|type|headline|overlay))\b/i.test(
      text,
    )
  ) {
    return {
      placement: "center",
      stack: "stack",
      face: "anton",
      wrap: cycleOverlayWrap(opts?.slideIndex),
    };
  }

  const wrap = cycleOverlayWrap(opts?.slideIndex);

  if (
    /\b((?:bottom|lower|low)[\s-]?left)\b/i.test(text) &&
    !/\btext over the top\b/i.test(text)
  ) {
    return { placement: "low_left", stack: "stack", face: faceDefault, wrap };
  }

  if (
    /\b(at the top|headline at the top|text at the top|top of the (?:photo|image|pic|picture))\b/i.test(
      text,
    ) &&
    !/\btext over the top\b/i.test(text)
  ) {
    return { placement: "top", stack: "stack", face: faceDefault, wrap };
  }

  if (
    /\b(at the bottom|headline at the bottom|text at the bottom|bottom (?:band|caption|headline))\b/i.test(
      text,
    ) &&
    !/\btext over the top\b/i.test(text)
  ) {
    return { placement: "bottom", stack: "stack", face: faceDefault, wrap };
  }

  // Corner/chip/cinematic/default: rotate center → top → bottom and pair → banner → poster.
  return {
    placement: cycleOverlayPlacement(opts?.slideIndex),
    stack: "stack",
    face: faceDefault,
    wrap,
  };
}

/**
 * Break a headline into lines. Pair keeps 2–3 phrase-lines; banner is one line;
 * poster is one word per line only for short titles (pilates). Word gaps on a
 * line are handled by overlayWordNodes, not by isolating every word.
 * When `exact` is true, skip the 5-word/28-char smash and wrap so each line
 * still fits the crop (owner-named overlays like WHAT FOUNDER OPS ACTUALLY DOES).
 */
export function splitOverlayStack(
  text: string,
  wrap: OverlayWrap = "pair",
  opts?: { exact?: boolean },
): string[] {
  if (opts?.exact) {
    const cleaned = formatExactOverlayHeadline(text);
    const words = cleaned.split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    if (words.length === 1) return [cleaned];
    // Pack words onto lines that stay within the char budget.
    const lines: string[] = [];
    let cur: string[] = [];
    for (const w of words) {
      const trial = [...cur, w].join(" ");
      if (cur.length && trial.length > OVERLAY_HEADLINE_MAX_CHARS) {
        lines.push(cur.join(" "));
        cur = [w];
      } else {
        cur.push(w);
      }
    }
    if (cur.length) lines.push(cur.join(" "));
    return lines.length ? lines : [cleaned];
  }

  const formatted = formatOverlayHeadline(text);
  const words = formatted.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (words.length === 1) return [formatted];

  let mode = wrap;
  if (mode === "poster" && words.length > 3) mode = "pair";
  if (mode === "banner") return [formatted];
  if (mode === "poster") {
    return words.map((word) => formatOverlayHeadline(word)).filter(Boolean);
  }

  const lineCount = words.length >= 5 ? 3 : 2;
  const lines: string[] = [];
  const base = Math.floor(words.length / lineCount);
  const extra = words.length % lineCount;
  let i = 0;
  for (let l = 0; l < lineCount; l++) {
    const n = base + (l < extra ? 1 : 0);
    const line = formatOverlayHeadline(words.slice(i, i + n).join(" "));
    i += n;
    if (line) lines.push(line);
  }
  return lines.length ? lines : [formatted];
}

/** Write a short punchy ALL-CAPS overlay headline from the post caption. */
export async function generateHeadline(brand: Brand, caption: string): Promise<string> {
  const nameless = isNamelessCreative(brand);
  const out = await callLLM({
    system: nameless
      ? "Write a punchy 2-5 word ALL-CAPS headline to overlay on a social-media image. No quotes, no emoji, no hashtags, no full stop, no dashes. Keep % ° and apostrophes in contractions and possessives (WE'RE, DON'T, 40%, 45°, DOG'S). Never end on a function word (the/a/of/to/for/with/not/in/on/at/and/or), dangling adverb (actually/really), or dangling adjective (annual/daily) that lost its noun. It must be a complete standalone headline, never a truncated sentence or sliced clause. Never include a person's name. Do not invent a specific job, fault, or this-week win — headline the craft or subject, not a fake incident. Just the words."
      : "Write a punchy 2-5 word ALL-CAPS headline to overlay on a social-media image. No quotes, no emoji, no hashtags, no full stop, no dashes. Keep % ° and apostrophes in contractions and possessives (WE'RE, DON'T, 40%, 45°, DOG'S). Never end on a function word (the/a/of/to/for/with/not/in/on/at/and/or), dangling adverb (actually/really), or dangling adjective (annual/daily) that lost its noun. It must be a complete standalone headline, never a truncated sentence or sliced clause. Do not invent a specific job, fault, or this-week win — headline the craft or subject, not a fake incident. Just the words.",
    messages: [
      {
        role: "user",
        content: nameless
          ? `Faceless brand voice. Post caption: "${caption}". Give the overlay headline (no personal names).`
          : `Brand: ${creativeBrandLabel(brand)}. Post caption: "${caption}". Give the overlay headline.`,
      },
    ],
    maxTokens: 20,
  });
  // Keep apostrophes (WE'RE / DOG'S). Only strip wrapping quotes and stray periods.
  const cleaned = stripPersonalNames(
    sanitizeChatText(out.replace(/[".]/g, "")).toUpperCase(),
    brand,
  );
  // Never fall back to the owner's personal brand name on faceless accounts.
  if (cleaned) return formatOverlayHeadline(cleaned);
  return formatOverlayHeadline(overlayMasthead(brand) || "START HERE");
}

/**
 * Horizontal safe inset for burned-in overlays.
 * Parent padding + child width must NOT both subtract this (that overflows left/right).
 * ~14% each side leaves room for tall phone crops / MMS letterboxing.
 */
export function overlaySafeInset(width: number): number {
  return Math.max(Math.round(width * 0.14), 64);
}

/** Scale overlay title so longer lines still fit inside the safe pad. */
function overlayFontSize(width: number, text: string, hasBody: boolean): number {
  const len = text.replace(/\s+/g, " ").trim().length;
  // With a body block, keep the title smaller so detail copy fits.
  if (hasBody) {
    if (len > 22) return Math.round(width * 0.038);
    if (len > 14) return Math.round(width * 0.044);
    return Math.round(width * 0.050);
  }
  if (len > 22) return Math.round(width * 0.042);
  if (len > 16) return Math.round(width * 0.050);
  if (len > 10) return Math.round(width * 0.058);
  return Math.round(width * 0.065);
}

function overlayBodyFontSize(width: number, text: string): number {
  const len = text.replace(/\s+/g, " ").trim().length;
  if (len > 160) return Math.round(width * 0.028);
  if (len > 100) return Math.round(width * 0.032);
  return Math.round(width * 0.036);
}

export type TextTileOptions = {
  /** Extra detail under the headline (idea blurbs, etc.). */
  body?: string;
  /** Small eyebrow above the title (e.g. "AI IDEA"). */
  eyebrow?: string;
  /** Force mixed display+body fonts (idea carousels). */
  mixedFonts?: boolean;
  /** Owner ask used to infer placement/stack/face when treatment is omitted. */
  ask?: string;
  /** Explicit recipe; wins over ask inference. */
  treatment?: OverlayTreatment;
  /** Carousel slide index — rotates center / top / bottom when the ask is unlocked. */
  slideIndex?: number;
  /** Owner named this headline exactly — skip 5-word/28-char smash. */
  exact?: boolean;
  /** Skip the burned masthead when stampBrandLogo will own the mark. */
  omitMasthead?: boolean;
};

export function resolveOverlayTreatment(
  opts?: TextTileOptions | null,
  visual?: VisualProfile | null,
): OverlayTreatment {
  if (opts?.treatment) {
    const wrap = opts.treatment.wrap ?? cycleOverlayWrap(opts.slideIndex);
    if (opts.treatment.placement === "chip") {
      return { ...opts.treatment, placement: "center", stack: "stack", wrap };
    }
    return { ...opts.treatment, wrap };
  }
  return inferOverlayTreatment(opts?.ask, visual, {
    ideaBlurb: Boolean(opts?.body),
    mixedFonts: opts?.mixedFonts,
    slideIndex: opts?.slideIndex,
  });
}

/**
 * One flex child per word, with a real spacer node between them.
 * Satori ignores margin on flex children and collapses ASCII spaces under
 * letter-spacing — a fixed-width NBSP box is the only gap it will paint.
 */
export function overlayWordNodes(
  line: string,
  gapPx: number,
): Array<Record<string, unknown>> {
  const words = line.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const nodes: Array<Record<string, unknown>> = [];
  const gap = Math.max(1, Math.round(gapPx));
  for (let i = 0; i < words.length; i++) {
    nodes.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexShrink: 0,
        },
        children: words[i],
      },
    });
    if (i < words.length - 1) {
      nodes.push({
        type: "div",
        props: {
          style: {
            display: "flex",
            width: gap,
            minWidth: gap,
            flexShrink: 0,
          },
          children: "\u00A0",
        },
      });
    }
  }
  return nodes;
}

function overlayBandStyle(
  placement: OverlayPlacement,
  width: number,
  height: number,
  pad: number,
  padY: number,
  scrim: { r: number; g: number; b: number },
): Record<string, unknown> {
  const fade = `rgba(${scrim.r},${scrim.g},${scrim.b}`;
  // Legacy chip recipe was a rounded bubble — never paint that.
  if (placement === "chip") placement = "center";
  if (placement === "top") {
    return {
      position: "absolute",
      top: 0,
      left: 0,
      width: `${width}px`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-start",
      padding: `${padY}px ${pad}px ${Math.round(pad * 1.35)}px ${pad}px`,
      background: `linear-gradient(to bottom, ${fade},0.9) 0%, ${fade},0.72) 55%, ${fade},0) 100%)`,
    };
  }
  if (placement === "center") {
    return {
      position: "absolute",
      top: 0,
      left: 0,
      width: `${width}px`,
      height: `${height}px`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
      padding: `${Math.round(height * 0.18)}px ${pad}px`,
      background: `linear-gradient(to bottom, ${fade},0.12) 0%, ${fade},0.38) 42%, ${fade},0.38) 58%, ${fade},0.12) 100%)`,
    };
  }
  if (placement === "low_left") {
    return {
      position: "absolute",
      bottom: 0,
      left: 0,
      width: `${Math.round(width * 0.72)}px`,
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      alignItems: "flex-start",
      padding: `${Math.round(pad * 1.1)}px ${pad}px ${padY}px ${pad}px`,
      background: `linear-gradient(to right, ${fade},0.82) 0%, ${fade},0.45) 70%, ${fade},0) 100%)`,
    };
  }
  return {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: `${width}px`,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    padding: `${Math.round(pad * 1.35)}px ${pad}px ${padY}px ${pad}px`,
    background: `linear-gradient(to top, ${fade},0.9) 0%, ${fade},0.72) 55%, ${fade},0) 100%)`,
  };
}

async function renderTile(
  imgBytes: Uint8Array,
  headline: string,
  masthead: string,
  visual?: VisualProfile | null,
  opts?: TextTileOptions,
): Promise<Buffer> {
  const palette = resolveBrandPalette(visual);
  const treatment = resolveOverlayTreatment(opts, visual);
  const meta = await sharp(Buffer.from(imgBytes)).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1350;
  const jpeg = await sharp(Buffer.from(imgBytes)).jpeg({ quality: 90 }).toBuffer();
  const dataUri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const body = (opts?.body ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
  const eyebrow = (opts?.eyebrow ?? "").replace(/\s+/g, " ").trim().slice(0, 28);
  const hasBody = Boolean(body);
  const titleLines = headline.split("\n").map((l) => l.trim()).filter(Boolean);
  const stacked = titleLines.length > 1;
  const longestTitle = titleLines.reduce((a, l) => (l.length > a.length ? l : a), headline);
  const titleFont =
    treatment.face === "anton" ? "Anton" : treatment.face === "playfair" ? "Playfair" : "Inter";
  const detailFont = "Inter";
  const leftAlign = treatment.placement === "low_left";
  const baseSize = overlayFontSize(width, longestTitle, hasBody);
  const stackScale = stacked && titleLines.length >= 5 ? 0.82 : stacked && titleLines.length >= 4 ? 0.9 : 1;
  const fontSize =
    treatment.placement === "center"
      ? Math.round(baseSize * 1.18 * stackScale)
      : Math.round(baseSize * 1.08 * stackScale);
  const bodySize = overlayBodyFontSize(width, body);
  const mastheadSize = Math.round(width * 0.036);
  const eyebrowSize = Math.round(width * 0.028);
  const pad = overlaySafeInset(width);
  const padY = Math.round(height * 0.045);
  const scrim = hexToRgb(palette.bgFrom);
  const showMasthead = Boolean(masthead?.trim());
  const titleAlign = leftAlign ? "left" : "center";
  const titleJustify = leftAlign ? "flex-start" : "center";

  const children: Array<Record<string, unknown>> = [
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
  ];

  if (showMasthead) {
    children.push({
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
                flexWrap: "wrap",
                justifyContent: "center",
                width: "100%",
                maxWidth: "100%",
                color: palette.text,
                fontFamily: detailFont,
                fontSize: `${mastheadSize}px`,
                letterSpacing: "0.08em",
                textAlign: "center",
                lineHeight: 1.15,
                textTransform: "uppercase",
              },
              children: masthead,
            },
          },
        ],
      },
    });
  }

  const textStack: Array<Record<string, unknown>> = [];
  if (eyebrow) {
    textStack.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexWrap: "wrap",
          width: "100%",
          maxWidth: "100%",
          marginBottom: `${Math.round(height * 0.012)}px`,
          color: palette.muted,
          fontFamily: "Inter",
          fontSize: `${eyebrowSize}px`,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          lineHeight: 1.2,
          textAlign: titleAlign,
          justifyContent: titleJustify,
        },
        children: eyebrow,
      },
    });
  }
  const wordGap = Math.max(10, Math.round(fontSize * (treatment.letterSpacing === "0em" ? 0.22 : 0.36)));
  const titleLineNodes = (stacked ? titleLines : [headline.replace(/\n/g, " ").trim()]).map(
    (line, i) => ({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexWrap: "nowrap",
          width: stacked ? "100%" : "auto",
          maxWidth: "100%",
          justifyContent: titleJustify,
          textAlign: titleAlign,
          marginTop: i === 0 ? 0 : Math.round(height * 0.008),
        },
        children: overlayWordNodes(line, wordGap),
      },
    }),
  );
  const titleCase = treatment.textCase ?? "upper";
  const tracking =
    treatment.letterSpacing ?? (treatment.face === "playfair" ? "0.01em" : "0.03em");
  textStack.push({
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        flexWrap: "nowrap",
        width: "100%",
        maxWidth: "100%",
        color: palette.text,
        fontFamily: titleFont,
        fontSize: `${fontSize}px`,
        letterSpacing: tracking,
        lineHeight: 1.05,
        textShadow: "0 4px 28px rgba(0,0,0,0.55)",
        textAlign: titleAlign,
        justifyContent: titleJustify,
        alignItems: leftAlign ? "flex-start" : "center",
        textTransform: titleCase === "upper" ? "uppercase" : "none",
      },
      children: titleLineNodes,
    },
  });
  if (treatment.rule) {
    textStack.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          width: `${Math.round(width * 0.18)}px`,
          height: `${Math.max(2, Math.round(height * 0.004))}px`,
          marginTop: `${Math.round(height * 0.014)}px`,
          background: palette.text,
          opacity: 0.92,
        },
        children: "",
      },
    });
  }
  if (hasBody) {
    textStack.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexWrap: "wrap",
          width: "100%",
          maxWidth: "100%",
          marginTop: `${Math.round(height * 0.018)}px`,
          color: palette.text,
          fontFamily: detailFont,
          fontSize: `${bodySize}px`,
          fontWeight: 400,
          lineHeight: 1.28,
          letterSpacing: "0.01em",
          textAlign: titleAlign,
          justifyContent: titleJustify,
          wordBreak: "break-word",
          overflowWrap: "break-word",
          opacity: 0.92,
        },
        children: body,
      },
    });
  }

  children.push({
    type: "div",
    props: {
      style: overlayBandStyle(treatment.placement, width, height, pad, padY, scrim),
      children: textStack,
    },
  });

  const svg = await satori(
    {
      type: "div",
      props: {
        style: { display: "flex", width: `${width}px`, height: `${height}px`, position: "relative" },
        children,
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
  const isBrand = typeof brandOrName !== "string";
  const visual =
    visualOverride ?? (isBrand ? (brandOrName.visual ?? null) : null);
  const palette = resolveBrandPalette(visual);
  // Faceless/nameless brands: no personal-name footer on the card.
  const masthead = isBrand
    ? overlayMasthead(brandOrName)
    : brandOrName.trim().toUpperCase();
  const body = isBrand ? stripPersonalNames(text, brandOrName) : text;

  const width = 1080;
  const height = 1080;
  const pad = overlaySafeInset(width);
  const fontSize = Math.round(
    width * (body.length > 90 ? 0.058 : body.length > 50 ? 0.072 : 0.092),
  );

  const children: Array<Record<string, unknown>> = [
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          maxWidth: "100%",
          width: "100%",
          color: palette.text,
          fontFamily: palette.bodyFont,
          fontSize: `${fontSize}px`,
          lineHeight: 1.2,
          letterSpacing: "0.01em",
          wordBreak: "break-word",
          overflowWrap: "break-word",
        },
        children: body,
      },
    },
  ];
  if (masthead) {
    children.push({
      type: "div",
      props: {
        style: {
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          position: "absolute",
          bottom: `${pad}px`,
          maxWidth: "100%",
          color: palette.muted,
          fontFamily: palette.displayFont,
          fontSize: `${Math.round(width * 0.03)}px`,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          textAlign: "center",
        },
        children: masthead,
      },
    });
  }

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
          position: "relative",
        },
        children,
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

/** Overlay a headline (and optional body) on a stored image; store + return the new media id (or null). */
export async function applyTextTile(
  brand: Brand,
  mediaId: string,
  headline: string,
  opts?: TextTileOptions,
): Promise<string | null> {
  const blob = await getMedia(mediaId);
  if (!blob) return null;
  try {
    const treatment = resolveOverlayTreatment(opts, brand.visual);
    const rawHeadline = stripPersonalNames(headline, brand);
    const exactFromAsk = extractExactOverlayHeadline(opts?.ask);
    const exact =
      Boolean(opts?.exact) ||
      (exactFromAsk != null &&
        formatExactOverlayHeadline(rawHeadline) === exactFromAsk);
    const safeHeadlineRaw = exact
      ? treatment.stack === "stack"
        ? splitOverlayStack(rawHeadline, treatment.wrap ?? "pair", { exact: true }).join("\n")
        : formatExactOverlayHeadline(rawHeadline)
      : treatment.stack === "stack"
        ? splitOverlayStack(rawHeadline, treatment.wrap ?? "pair").join("\n")
        : formatOverlayHeadline(rawHeadline);
    const safeHeadline = applyOverlayCase(safeHeadlineRaw, treatment.textCase ?? "upper");
    const safeBody = opts?.body ? stripPersonalNames(opts.body, brand) : undefined;
    const safeEyebrow = opts?.eyebrow ? stripPersonalNames(opts.eyebrow, brand) : undefined;
    const masthead = opts?.omitMasthead ? "" : overlayMasthead(brand);
    const tiled = await renderTile(blob.bytes, safeHeadline, masthead, brand.visual, {
      ...opts,
      body: safeBody,
      eyebrow: safeEyebrow,
      treatment,
    });
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
    const headline = formatOverlayHeadline(stripPersonalNames(overlay, brand));
    const ctaLine = stripPersonalNames((cta ?? "").trim(), brand).slice(0, 36);
    const padX = overlaySafeInset(width);
    const headlineSize = overlayFontSize(width, headline, Boolean(ctaLine));

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
                  padding: `0 ${padX}px ${Math.round(height * 0.04)}px`,
                  background: `linear-gradient(to top, rgba(${scrim.r},${scrim.g},${scrim.b},0.72), rgba(${scrim.r},${scrim.g},${scrim.b},0))`,
                },
                children: [
                  {
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        flexWrap: "wrap",
                        maxWidth: "100%",
                        width: "100%",
                        color: palette.text,
                        fontFamily: palette.displayFont,
                        fontSize: `${headlineSize}px`,
                        letterSpacing: "0.06em",
                        lineHeight: 1.18,
                        textAlign: "center",
                        justifyContent: "center",
                        textTransform: "uppercase",
                        wordBreak: "break-word",
                        overflowWrap: "break-word",
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
                            flexWrap: "wrap",
                            maxWidth: "100%",
                            width: "100%",
                            marginTop: `${Math.round(height * 0.02)}px`,
                            color: palette.muted,
                            fontFamily: palette.bodyFont,
                            fontSize: `${Math.round(width * 0.045)}px`,
                            letterSpacing: "0.04em",
                            wordBreak: "break-word",
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

const LOGO_MAX_BYTES = 2_000_000;

/** Composite a logo onto a still, bottom-left, ~16% of width. */
export async function compositeBrandLogo(base: Buffer, logo: Buffer): Promise<Buffer> {
  const meta = await sharp(base).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;
  const markW = Math.max(48, Math.round(width * 0.16));
  const resized = await sharp(logo)
    .resize({ width: markW, withoutEnlargement: true })
    .ensureAlpha()
    .png()
    .toBuffer();
  const lm = await sharp(resized).metadata();
  const pad = Math.round(width * 0.045);
  const left = pad;
  const top = Math.max(0, height - (lm.height ?? markW) - pad);
  return sharp(base)
    .composite([{ input: resized, left, top }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Typographic wordmark when there is no logo_url — corner or Canva-style badge. */
export async function compositeBrandWordmark(
  base: Buffer,
  mark: string,
  visual?: VisualProfile | null,
  opts?: { placement?: "wordmark" | "badge" },
): Promise<Buffer> {
  const meta = await sharp(base).metadata();
  const width = meta.width ?? 1080;
  const height = meta.height ?? 1080;
  const palette = resolveBrandPalette(visual);
  const photoLum = await samplePhotoLuminance(base);
  const paint = pickDecoPaint(
    { stroke: palette.text, fill: palette.muted, accent: palette.bgFrom },
    photoLum,
  );
  const label = mark.replace(/\s+/g, " ").trim().slice(0, 32);
  const badge = opts?.placement === "badge";
  const fontSize = Math.max(28, Math.round(width * (badge ? 0.042 : 0.032)));
  const padX = badge ? Math.round(fontSize * 1.1) : 0;
  const markW = Math.min(
    Math.round(width * (badge ? 0.58 : 0.62)),
    Math.max(220, Math.round(label.length * fontSize * 0.62) + padX * 2),
  );
  const markH = Math.round(fontSize * (badge ? 3.2 : 2.4));
  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: badge ? "center" : "flex-start",
          width: `${markW}px`,
          height: `${markH}px`,
          ...(badge ? { padding: `0 ${padX}px`, background: paint.fill } : {}),
          color: badge ? paint.ink : palette.text,
          fontFamily: palette.displayFont,
          fontSize: `${fontSize}px`,
          letterSpacing: badge ? "0.18em" : "0.14em",
          textTransform: "uppercase",
          fontWeight: 700,
        },
        children: label,
      },
    } as unknown as Parameters<typeof satori>[0],
    {
      width: markW,
      height: markH,
      fonts: [
        { name: "Anton", data: ANTON, weight: 400, style: "normal" },
        { name: "Playfair", data: SERIF, weight: 700, style: "normal" },
        { name: "Inter", data: INTER_REGULAR, weight: 400, style: "normal" },
        { name: "Inter", data: INTER_BOLD, weight: 700, style: "normal" },
      ],
    },
  );
  const png = new Resvg(svg, { fitTo: { mode: "width", value: markW } }).render().asPng();
  const pad = Math.round(width * 0.045);
  const left = badge ? Math.max(0, width - markW - pad) : pad;
  const top = badge ? pad : Math.max(0, height - markH - pad);
  return sharp(base)
    .composite([{ input: png, left, top }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

async function fetchBrandLogoBytes(logoUrl: string): Promise<Buffer | null> {
  const url = safePublicUrl(logoUrl);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { Accept: "image/*,*/*;q=0.8", "User-Agent": "KipBot/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype && !/^image\//i.test(ctype) && !/octet-stream/i.test(ctype)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > LOGO_MAX_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

/**
 * Stamp this still: optional decorative chrome plus logo/wordmark.
 * Sticker/badge are identity vehicles (labeled mark), never empty pills.
 * Default is a clean photo — kit is per-post, not a house stamp.
 */
export async function stampBrandLogo(
  brand: Brand,
  mediaId: string,
  opts?: { elements?: FeedElementsMode; deco?: DecoPiece[] },
): Promise<string | null> {
  if (isNamelessCreative(brand)) return mediaId;
  const blob = await getMedia(mediaId);
  if (!blob) return null;
  try {
    let stamped: Buffer = Buffer.from(blob.bytes);
    let changed = false;
    const mode: FeedElementsMode =
      opts?.elements === "constructed" || opts?.elements === "mark" ? opts.elements : "none";
    const deco = Array.isArray(opts?.deco) ? opts.deco : [];
    const kit = resolveBrandDecoKit(brand.visual, deco);
    const paintPieces = (kit?.pieces ?? []).filter((p) => !isIdentityDecoPiece(p));
    if (kit && paintPieces.length) {
      const palette = resolveBrandPalette(brand.visual);
      stamped = Buffer.from(
        await compositeBrandDecoration(stamped, { ...kit, pieces: paintPieces }, {
          stroke: palette.text,
          fill: palette.muted,
          accent: palette.bgFrom,
        }),
      );
      changed = true;
    }
    const wantMark = mode !== "none" || deco.length > 0;
    let marked = false;
    const logoUrl = brand.visual?.logo_url;
    if (wantMark && logoUrl) {
      const logo = await fetchBrandLogoBytes(logoUrl);
      if (logo) {
        stamped = Buffer.from(await compositeBrandLogo(stamped, logo));
        marked = true;
        changed = true;
      }
    }
    if (wantMark && !marked) {
      const mark = overlayMasthead(brand);
      if (mark) {
        stamped = Buffer.from(
          await compositeBrandWordmark(stamped, mark, brand.visual, {
            placement:
              deco.includes("sticker") || deco.includes("badge") || kit?.mark === "badge"
                ? "badge"
                : "wordmark",
          }),
        );
        changed = true;
      }
    }
    if (!changed) return mediaId;
    const newId = randomUUID();
    await query(
      `insert into media_assets (id, brand_id, storage_path, kind, source, content_type)
       values ($1, $2, $3, 'photo', 'operator', 'image/jpeg')`,
      [newId, brand.id, newId],
    );
    await putMedia(newId, new Uint8Array(stamped), "image/jpeg");
    return newId;
  } catch (err) {
    console.error(`stampBrandLogo: failed for media ${mediaId}`, err);
    return mediaId;
  }
}
