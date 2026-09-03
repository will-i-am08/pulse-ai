import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { query, getMedia, putMedia, getServerEnv, type Brand } from "@pulse/shared";
import { callLLM } from "./llm.js";

// AI image editing via Replicate (Flux Kontext by default). The agent writes a
// tailored edit instruction from the actual photo + brand, then runs the model.
// Business = truthful (keep the real subject, improve it); personal = bolder.

type ContentPart = Exclude<Anthropic.MessageParam["content"], string>[number];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Vision LLM: given the photo + brand, write a one-line Flux Kontext edit instruction. */
async function generateEditPrompt(brand: Brand, imgBytes: Uint8Array): Promise<string> {
  const business = brand.account_type !== "personal";
  const system = [
    "You write ONE short image-editing instruction for the Flux Kontext model that turns a client's phone photo into a scroll-stopping social-media image.",
    business
      ? "This is a BUSINESS account. Keep the real subject/product/place TRUTHFUL — improve lighting, colour, cleanliness, background and composition so it looks professionally shot. Never invent a different product or scene."
      : "This is a PERSONAL/creator account. Be bolder and more stylised — vivid, high-energy, eye-catching — while keeping the person/subject recognisable.",
    "Base it entirely on what is actually in the photo. Output ONLY the instruction (one or two sentences), no preamble, no quotes.",
  ].join("\n");

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
  return Buffer.from(await (await fetch(out)).arrayBuffer());
}

/**
 * Style a client's photo and store the result as a new media asset. Returns the
 * new media id, or null if editing is disabled/unavailable (caller falls back to
 * the original photo).
 */
export async function editImageForBrand(brand: Brand, mediaId: string): Promise<string | null> {
  if (!getServerEnv().REPLICATE_API_TOKEN) return null;
  const blob = await getMedia(mediaId);
  if (!blob || !blob.contentType.startsWith("image/")) return null;
  try {
    const prompt = await generateEditPrompt(brand, blob.bytes);
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
