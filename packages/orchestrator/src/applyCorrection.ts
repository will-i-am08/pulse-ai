import { query, queryOne, brandVoiceProfileSchema } from "@pulse/shared";
import type { Brand } from "@pulse/shared";
import { callLLM } from "./llm.js";

async function loadBrand(brandId: string): Promise<Brand> {
  const brand = await queryOne<Brand>(`select * from brands where id = $1`, [brandId]);
  if (!brand) {
    throw new Error(`applyCorrection: brand not found (${brandId}): no row`);
  }
  return brand;
}

/** One LLM call to turn a before/after caption pair into a reusable style rule. */
async function summariseDelta(before: string, after: string): Promise<string> {
  const text = await callLLM({
    system:
      "You extract reusable brand-voice rules from caption edits. Be terse and general — " +
      "the rule should apply to future captions, not just describe this one edit.",
    messages: [
      {
        role: "user",
        content:
          `Original caption:\n"""${before}"""\n\nRevised caption:\n"""${after}"""\n\n` +
          "In one short sentence (max 20 words), state the general style rule this edit implies. " +
          'Output only the rule, no preamble, e.g. "Prefer shorter captions" or "Avoid exclamation marks".',
      },
    ],
    maxTokens: 100,
  });
  return text.trim().replace(/^["']|["']$/g, "");
}

/**
 * Fold an approval-time edit into brand_voice_profile.notes and store the
 * before/after pair in `corrections`. Used both by processInbound (inbound
 * SMS edits) and, per BUILD_CONTRACTS.md, by the dashboard's edit-then-
 * approve flow.
 */
export async function applyCorrection(
  brandId: string,
  postId: string,
  before: string,
  after: string,
): Promise<void> {
  await query(
    `insert into corrections (brand_id, post_id, before_caption, after_caption)
     values ($1, $2, $3, $4)`,
    [brandId, postId, before, after],
  );

  if (before.trim() === after.trim()) return; // nothing to learn

  const brand = await loadBrand(brandId);
  const profile = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});

  let learnedNote: string;
  try {
    learnedNote = await summariseDelta(before, after);
  } catch {
    learnedNote = `Edited: "${before.slice(0, 60)}" -> "${after.slice(0, 60)}"`;
  }
  if (!learnedNote) return;

  const nextProfile = brandVoiceProfileSchema.parse({
    ...profile,
    notes: [...profile.notes, learnedNote].slice(-50), // keep the note list bounded
  });

  await query(
    `update brands set brand_voice_profile = $1::jsonb where id = $2`,
    [JSON.stringify(nextProfile), brandId],
  );
}
