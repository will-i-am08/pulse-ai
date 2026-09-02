import {
  query,
  queryOne,
  brandVoiceProfileSchema,
  type AccountType,
  type Brand,
  type OnboardingState,
} from "@pulse/shared";
import { callLLM } from "./llm.js";

// Fixed, ordered question sets — deterministic and reliable. The LLM handles
// parsing the business/personal choice, reading the website, and compiling the
// final profile; the questions themselves are asked verbatim, one at a time.
interface Question {
  key: string;
  text: string;
}

const BUSINESS_QUESTIONS: Question[] = [
  { key: "what", text: "What does the business do — what do you sell or offer?" },
  { key: "audience", text: "Who's your ideal customer or audience?" },
  { key: "tone", text: "How should your posts *sound*? (e.g. warm, playful, professional, bold)" },
  { key: "dos_donts", text: "Anything you always want in your posts, or never want? (do's and don'ts)" },
  { key: "examples", text: "Paste one or two captions whose style you love — or say 'skip'." },
  { key: "hashtags_emojis", text: "Hashtags and emojis — love them, hate them, or just a few?" },
];

const PERSONAL_QUESTIONS: Question[] = [
  { key: "what", text: "What's your account about — your niche or what you post?" },
  { key: "audience", text: "Who follows you, or who do you want to reach?" },
  { key: "tone", text: "What's your vibe? (e.g. funny, aesthetic, motivational, chill)" },
  { key: "dos_donts", text: "Anything you always want in your posts, or never want?" },
  { key: "examples", text: "Any posts whose style you love? Paste one or two — or say 'skip'." },
  { key: "hashtags_emojis", text: "Emojis and hashtags — how do you feel about them?" },
];

function questionsFor(type: AccountType): Question[] {
  return type === "business" ? BUSINESS_QUESTIONS : PERSONAL_QUESTIONS;
}

async function saveState(brandId: string, state: OnboardingState): Promise<void> {
  await query("update brands set onboarding_state = $2::jsonb where id = $1", [brandId, JSON.stringify(state)]);
}

/** Strip a web page to rough text, then summarise the brand from it (best-effort). */
async function readWebsite(url: string): Promise<string | null> {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const res = await fetch(withProto, { headers: { "User-Agent": "PulseBot/1.0" } });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
    if (text.length < 40) return null;
    return await callLLM({
      system:
        "You extract a brand summary from website text. In 3-5 sentences, describe what the business/person does, who they serve, and the tone of their writing. Plain text only.",
      messages: [{ role: "user", content: `Website text:\n"""${text}"""\n\nSummarise the brand.` }],
      maxTokens: 300,
    });
  } catch {
    return null;
  }
}

function parseAccountTypeKeyword(body: string): AccountType | null {
  const b = body.toLowerCase();
  if (/\b(business|company|shop|store|brand|cafe|café|agency|firm|studio)\b/.test(b)) return "business";
  if (/\b(personal|myself|my own|just me|individual|creator|influencer)\b/.test(b)) return "personal";
  return null;
}

async function parseAccountType(body: string): Promise<AccountType> {
  const kw = parseAccountTypeKeyword(body);
  if (kw) return kw;
  const out = await callLLM({
    system: 'Reply with exactly one word: "business" or "personal".',
    messages: [{ role: "user", content: `Is this a business or personal account? Message: "${body}"` }],
    maxTokens: 5,
  });
  return out.toLowerCase().includes("person") ? "personal" : "business";
}

/**
 * Begin onboarding for a pending brand: read the website if present, set state
 * in_progress, and return the greeting + first question (business vs personal).
 */
export async function startOnboarding(brandId: string): Promise<string> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`startOnboarding: brand ${brandId} not found`);

  const answers: Record<string, string> = {};
  if (brand.website) {
    const summary = await readWebsite(brand.website);
    if (summary) answers.website_summary = summary;
  }

  const hello = brand.name ? `Hi ${brand.name}! ` : "Hi! ";
  const seen = answers.website_summary
    ? " I had a quick look at your website, so this'll be short."
    : "";
  const intro =
    `${hello}I'm your Pulse agent — I'll turn your photos into on-brand posts.` +
    ` Let's get you set up (takes a minute).${seen}`;

  // account_type is captured at signup — don't ask it again; go straight to Q1.
  if (brand.account_type) {
    await saveState(brand.id, { status: "in_progress", type: brand.account_type, step: 1, answers });
    const q = questionsFor(brand.account_type)[0]!;
    return `${intro}\n\n${q.text}`;
  }

  // Fallback (no type on the brand): ask business vs personal first.
  await saveState(brand.id, { status: "in_progress", step: 0, answers });
  return `${intro}\n\nFirst: is this for a **business** or a **personal** account?`;
}

/** Handle one message during onboarding. Returns the reply and whether setup is complete. */
export async function onboardingTurn(brand: Brand, body: string): Promise<{ reply: string; done: boolean }> {
  const prev = brand.onboarding_state ?? { status: "in_progress" };
  const answers: Record<string, string> = { ...(prev.answers ?? {}) };
  const step = prev.step ?? 0;

  // Step 0: they're telling us business vs personal.
  if (step === 0 || !prev.type) {
    const type = await parseAccountType(body);
    await query("update brands set account_type = $2 where id = $1", [brand.id, type]);
    await saveState(brand.id, { status: "in_progress", type, step: 1, answers });
    const q = questionsFor(type)[0]!;
    return { reply: `Great — a ${type} account.\n\n${q.text}`, done: false };
  }

  const type = prev.type;
  const questions = questionsFor(type);
  const current = questions[step - 1];
  if (current) answers[current.key] = body;

  if (step < questions.length) {
    await saveState(brand.id, { status: "in_progress", type, step: step + 1, answers });
    return { reply: questions[step]!.text, done: false };
  }

  // Final answer received — compile the profile and finish.
  const summary = await compileProfile(brand, type, answers);
  await saveState(brand.id, { status: "done", type, answers });
  return {
    reply:
      `Perfect — you're all set! Here's what I've got:\n\n${summary}\n\n` +
      `Send me a photo anytime and I'll draft a caption. You can also just tell me things like "less emojis" and I'll learn.`,
    done: true,
  };
}

/** Turn the collected answers into a stored BrandVoiceProfile + strategy notes; return a short recap. */
async function compileProfile(
  brand: Brand,
  type: AccountType,
  answers: Record<string, string>,
): Promise<string> {
  const raw = await callLLM({
    system:
      "You compile a brand-voice profile from an onboarding Q&A. Output ONLY JSON matching: " +
      '{"tone":string[],"dos":string[],"donts":string[],"example_captions":string[],"banned_words":string[],' +
      '"emoji_policy":"none"|"sparing"|"liberal","hashtag_policy":string,"notes":string[],"voice_notes":string}. ' +
      "Infer sensible values; keep arrays short and specific.",
    messages: [
      {
        role: "user",
        content:
          `Account type: ${type}\n` +
          Object.entries(answers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n"),
      },
    ],
    maxTokens: 700,
  });

  let profile;
  let voiceNotes = "";
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    voiceNotes = typeof json.voice_notes === "string" ? json.voice_notes : "";
    profile = brandVoiceProfileSchema.parse(json);
  } catch {
    profile = brandVoiceProfileSchema.parse({ notes: Object.values(answers) });
  }

  await query("update brands set brand_voice_profile = $2::jsonb where id = $1", [
    brand.id,
    JSON.stringify(profile),
  ]);
  await query(
    `insert into strategy_notes (brand_id, voice_notes, content_mix)
     values ($1, $2, '{}'::jsonb)
     on conflict (brand_id) do update set voice_notes = excluded.voice_notes, last_updated = now()`,
    [brand.id, voiceNotes || (answers.what ?? null)],
  );

  const tone = profile.tone.length ? profile.tone.join(", ") : "friendly";
  const donts = profile.donts.length ? profile.donts.join("; ") : "none noted";
  return `• Tone: ${tone}\n• Emoji: ${profile.emoji_policy}\n• Don'ts: ${donts}`;
}
