import {
  query,
  queryOne,
  brandVoiceProfileSchema,
  emptyBrandVoiceProfile,
  sanitizeChatText,
  type AccountType,
  type Brand,
  type OnboardingState,
  type OnboardingTurnMsg,
} from "@pulse/shared";
import { callLLM } from "./llm.js";
import { seedPendingPlan } from "./nichePlan.js";

// Adaptive, LLM-driven onboarding — a real interview, not a fixed form. The
// agent reads each answer, reacts, digs deeper, and decides its own next
// question, then compiles a voice profile from the whole conversation.

const MAX_ANSWERS = 10; // backstop: the model should finish on confidence at 5-8

async function saveState(brandId: string, state: OnboardingState): Promise<void> {
  await query("update brands set onboarding_state = $2::jsonb where id = $1", [brandId, JSON.stringify(state)]);
}

/** Pull the owner's first name from the onboarding chat and store it for personal address. */
async function captureOwnerName(brand: Brand, transcript: OnboardingTurnMsg[]): Promise<void> {
  try {
    const convo = transcript.map((t) => `${t.role}: ${t.content}`).join("\n");
    const raw = await callLLM({
      system:
        'From this onboarding chat, extract the business owner\'s OWN first name if they gave it. ' +
        'Output JSON {"first_name":""} — empty string if they never said it.',
      messages: [{ role: "user", content: convo }],
      maxTokens: 30,
    });
    const name = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { first_name?: string })?.first_name;
    if (typeof name === "string" && name.trim()) {
      const facts = { ...(brand.facts ?? {}), owner_name: name.trim().split(/\s+/)[0] };
      await query("update brands set facts = $1::jsonb where id = $2", [JSON.stringify(facts), brand.id]);
    }
  } catch {
    /* best-effort — a missing name just means we address them as "you" */
  }
}

/** Extract the niche + admired accounts and seed a pending plan (kicks off research). */
async function captureNicheAndSeedPlan(brand: Brand, transcript: OnboardingTurnMsg[]): Promise<void> {
  try {
    const convo = transcript.map((t) => `${t.role}: ${t.content}`).join("\n");
    const raw = await callLLM({
      system:
        "From this onboarding chat, extract the business's niche/industry (a short phrase) and any 1–2 accounts/competitors the owner said they admire. " +
        'Output JSON {"niche":"","exemplars":""} — empty strings if not stated.',
      messages: [{ role: "user", content: convo }],
      maxTokens: 80,
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { niche?: string; exemplars?: string };
    const niche = parsed.niche?.trim();
    if (niche) await seedPendingPlan(brand.id, niche, parsed.exemplars?.trim() || null);
  } catch {
    /* best-effort — no plan seeded just means no custom plan this run */
  }
}

function interviewerSystem(brand: Brand, type: AccountType, websiteSummary?: string): string {
  const kind = type === "personal" ? "personal social-media account" : "business";
  return [
    `You are Kip, "${brand.name}"'s (a ${kind}) own social media manager, getting set up. You run their socials end to end. Warm, sharp, human, like texting a switched-on mate.`,
    websiteSummary ? `From their website you already know: ${websiteSummary}` : "",
    "Through a natural back-and-forth, learn what you need to write posts that sound exactly like them: what they do, who they're for, their tone, must-dos and never-dos, examples they love, and their emoji/hashtag style.",
    "Early on, warmly get their first name (by your third message at the latest) so you can address them personally from here on.",
    "Make sure you learn their business/niche clearly, and ask for 1-2 accounts in their space they admire (so you can study what's working before building their plan).",
    "HOW YOU TALK (absolute rules):",
    "- Your whole message contains AT MOST ONE question mark. One. If you catch yourself writing a second question, delete it and keep only the most important one. Two questions in one message is failure.",
    "- Short. Your question stays under 25 words. Most messages are 1-2 sentences.",
    "- Plain words. No jargon like POV, format, cadence, or leverage.",
    "- When they are vague, venture a concrete guess for them to react to. Never hand their fog back with a list of options.",
    "- React specifically to what they just said before you ask. Prove you listened.",
    "- Punctuate like a human texter: ... for a thoughtful pause, ! for genuine enthusiasm. Sparingly, never performative, never more than one ! per message.",
    "- No em dashes, ever. No markdown, no bold, no lists. Plain SMS text.",
    "- Never re-ask something you already know (including from the website).",
    "FINISH:",
    "- You are done the moment you hold all six: niche, audience, angle, tone, one never-do, content they like. The instant you have them, wrap up. Do not ask one more question. Do not save anything for later. Extra turns actively make this worse.",
    "- Typical finish: 5 to 8 turns. Never pad to fill turns, never rush.",
    `- Finish with a line that STARTS EXACTLY with "SETUP_COMPLETE:" then a short, warm sign-off. Tailor the next step: personal accounts get the photo ask, business or faceless accounts are told their first ideas are coming.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function toMessages(transcript: OnboardingTurnMsg[]): { role: "user" | "assistant"; content: string }[] {
  return transcript.map((t) => ({ role: t.role, content: t.content }));
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

/** Begin onboarding: read the website if present, then open the conversation (LLM-generated). */
export async function startOnboarding(brandId: string): Promise<string> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`startOnboarding: brand ${brandId} not found`);
  const type: AccountType = brand.account_type ?? "business";

  let websiteSummary: string | undefined;
  if (brand.website) {
    websiteSummary = (await readWebsite(brand.website)) ?? undefined;
  }

  const system = interviewerSystem(brand, type, websiteSummary);
  const seed: OnboardingTurnMsg = {
    role: "user",
    content:
      "Start the onboarding now: greet them by name, and (if you learned things from their website) briefly reflect that back before asking your first, most useful question.",
  };
  const opening = await callLLM({ system, messages: toMessages([seed]), maxTokens: 250 });

  const transcript: OnboardingTurnMsg[] = [seed, { role: "assistant", content: opening }];
  const answers: Record<string, string> = websiteSummary ? { website_summary: websiteSummary } : {};
  await saveState(brand.id, { status: "in_progress", type, turns: 0, transcript, answers });
  return sanitizeChatText(await enforceOneQuestion(opening));
}

/** Instant acknowledgement sent the moment the last answer lands, while the wrap-up compiles. */
export const WRAP_ACK = "Awesome, got everything. Writing your voice up now, one sec.";

/** Count the questions in a message. */
function questionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

/**
 * Backstop for the one-question rule: prompts ask, but the model still slips.
 * If a reply asks more than one question, have the model keep only the most
 * important one. One repair attempt, then accept (never loop forever).
 */
async function enforceOneQuestion(reply: string): Promise<string> {
  if (questionCount(reply) <= 1) return reply;
  try {
    const fixed = await callLLM({
      system:
        "Rewrite the message below as ONE short question (under 25 words). " +
        "Keep the reaction to what they said, keep only the single most important question, delete the rest. " +
        "Plain SMS text. No em dashes, no markdown. Output ONLY the rewritten message.",
      messages: [{ role: "user", content: reply }],
      maxTokens: 120,
    });
    const clean = fixed.trim();
    return questionCount(clean) >= questionCount(reply) ? reply : clean;
  } catch {
    return reply;
  }
}

/**
 * One conversational turn: runs the interview only (fast). Returns the reply
 * and whether the interview is complete. When complete, the caller must send
 * WRAP_ACK first, then run finishOnboarding in the background and deliver its
 * rundown as a second message. Never bundle the ack with the rundown: the
 * compile takes 30s+ and the owner should never stare at dead air.
 */
export async function onboardingNext(
  brand: Brand,
  body: string,
): Promise<{ reply: string; complete: boolean }> {
  const prev = brand.onboarding_state ?? { status: "in_progress" };
  const type: AccountType = prev.type ?? brand.account_type ?? "business";
  const transcript: OnboardingTurnMsg[] = [...(prev.transcript ?? [])];
  const answers: Record<string, string> = { ...(prev.answers ?? {}) };
  const turns = (prev.turns ?? 0) + 1;

  transcript.push({ role: "user", content: body });

  const messages = toMessages(transcript);
  if (turns >= MAX_ANSWERS) {
    messages.push({
      role: "user",
      content: "(That's plenty to work with, please wrap up now with SETUP_COMPLETE and a warm sign-off.)",
    });
  }

  const system = interviewerSystem(brand, type, answers.website_summary);
  // Headroom so a reply never gets cut off mid-word. Brevity is enforced by the
  // prompt, not by starving the token budget (which truncated messages mid-sentence).
  const raw = await callLLM({ system, messages, maxTokens: 600 });

  const marker = /^\s*SETUP_COMPLETE:\s*/i;
  const complete = marker.test(raw) || turns >= MAX_ANSWERS;

  if (complete) {
    // Park the sign-off; the rundown is built by finishOnboarding.
    transcript.push({ role: "assistant", content: raw.replace(marker, "").trim() });
    await saveState(brand.id, { status: "wrapping_up", type, turns, transcript, answers });
    return { reply: WRAP_ACK, complete: true };
  }

  transcript.push({ role: "assistant", content: raw });
  await saveState(brand.id, { status: "in_progress", type, turns, transcript, answers });
  return { reply: sanitizeChatText(await enforceOneQuestion(raw)), complete: false };
}

/** One conversational turn. Returns the agent's reply and whether setup is complete. */
export async function onboardingTurn(brand: Brand, body: string): Promise<{ reply: string; done: boolean }> {
  const step = await onboardingNext(brand, body);
  if (!step.complete) return { reply: step.reply, done: false };
  const rundown = await finishOnboarding(brand.id);
  return { reply: `${step.reply}\n\n${rundown}`, done: true };
}

/** Next step tailored to the account: personal brands send a photo, everyone else gets ideas first. */
function nextStepFor(type: AccountType, transcript: OnboardingTurnMsg[]): string {
  const faceless = transcript.some((t) => /faceless/i.test(t.content));
  if (type === "personal" && !faceless) return "Send me a photo anytime and we'll get rolling.";
  return "I'll send your first ideas shortly. Anything you want to add before I start, just say.";
}

/**
 * Heavy wrap-up: compile the voice profile, capture name/niche, seed the plan
 * research, and build the rundown message (sign-off + recap + plan promise).
 * Runs AFTER the instant ack, so it can take its time.
 */
export async function finishOnboarding(brandId: string): Promise<string> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`finishOnboarding: brand ${brandId} not found`);
  const state = brand.onboarding_state ?? { status: "wrapping_up" };
  const type: AccountType = state.type ?? brand.account_type ?? "business";
  const transcript: OnboardingTurnMsg[] = [...(state.transcript ?? [])];
  const answers: Record<string, string> = { ...(state.answers ?? {}) };
  const turns = state.turns ?? 0;

  const signoff =
    transcript.length > 0 && transcript[transcript.length - 1]?.role === "assistant"
      ? (transcript.pop() as OnboardingTurnMsg).content
      : "You're all set.";
  const recap = await compileProfile(brand, type, transcript);
  await saveState(brand.id, { status: "done", type, turns, transcript, answers });
  await captureOwnerName(brand, transcript);
  await captureNicheAndSeedPlan(brand, transcript);
  return (
    `${signoff}\n\n${recap}\n\n${nextStepFor(type, transcript)}\n\n` +
    `One more thing: I'm studying your space to build you a tailored content plan. I'll send it over in a couple of minutes 👀`
  );
}

/** Compile the whole conversation into a stored BrandVoiceProfile + strategy notes; return a short recap. */
async function compileProfile(
  brand: Brand,
  type: AccountType,
  transcript: OnboardingTurnMsg[],
): Promise<string> {
  const convo = transcript
    .filter((t) => t.content && !t.content.startsWith("("))
    .map((t) => `${t.role === "user" ? "Client" : "Agent"}: ${t.content}`)
    .join("\n");

  const raw = await callLLM({
    system:
      "You compile a brand-voice profile from an onboarding conversation. Output ONLY JSON matching: " +
      '{"tone":string[],"dos":string[],"donts":string[],"example_captions":string[],"banned_words":string[],' +
      '"emoji_policy":"none"|"sparing"|"liberal","hashtag_policy":string,"notes":string[],"voice_notes":string}. ' +
      "Infer sensible values from what the client actually said; keep arrays short and specific.",
    messages: [{ role: "user", content: `Account type: ${type}\n\nConversation:\n${convo}` }],
    maxTokens: 700,
  });

  let profile;
  let voiceNotes = "";
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    voiceNotes = typeof json.voice_notes === "string" ? json.voice_notes : "";
    profile = brandVoiceProfileSchema.parse(json);
  } catch {
    profile = brandVoiceProfileSchema.parse({});
  }

  await query("update brands set brand_voice_profile = $2::jsonb where id = $1", [
    brand.id,
    JSON.stringify(profile),
  ]);
  await query(
    `insert into strategy_notes (brand_id, voice_notes, content_mix)
     values ($1, $2, '{}'::jsonb)
     on conflict (brand_id) do update set voice_notes = excluded.voice_notes, last_updated = now()`,
    [brand.id, voiceNotes || null],
  );

  const tone = profile.tone.length ? profile.tone.join(", ") : "friendly";
  const donts = profile.donts.length ? profile.donts.join("; ") : "none noted";
  return `Here's what I've got: tone is ${tone}; emoji ${profile.emoji_policy}; never: ${donts}. You can tweak any of this on your dashboard anytime.`;
}


/** Soft-restart the interview for any brand: fresh transcript via startOnboarding. */
export async function restartOnboarding(brandId: string): Promise<string> {
  await query(
    `update brands set onboarding_state = $2::jsonb where id = $1`,
    [brandId, JSON.stringify({ status: "pending" })],
  );
  return startOnboarding(brandId);
}

/**
 * Hard-reset a lab brand only (facts.lab === true): wipe thread + notes + drafts,
 * clear voice/strategy derived from onboarding, re-arm pending onboarding.
 */
export async function hardResetLabBrand(brandId: string): Promise<void> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`hardResetLabBrand: brand ${brandId} not found`);
  if (!brand.facts?.lab) {
    throw new Error(`hardResetLabBrand: brand ${brandId} is not a lab brand (facts.lab)`);
  }

  await query(`delete from lab_notes where brand_id = $1`, [brandId]);
  await query(`delete from corrections where brand_id = $1`, [brandId]);
  await query(`delete from approval_log where brand_id = $1`, [brandId]);
  await query(`delete from posts where brand_id = $1`, [brandId]);
  await query(`delete from messages where brand_id = $1`, [brandId]);
  await query(
    `delete from media_blobs where media_id in (select id from media_assets where brand_id = $1)`,
    [brandId],
  );
  await query(`delete from media_assets where brand_id = $1`, [brandId]);
  await query(`delete from strategy_notes where brand_id = $1`, [brandId]);

  const facts = { ...(brand.facts ?? {}), lab: true as const };
  await query(
    `update brands
        set onboarding_state = $2::jsonb,
            brand_voice_profile = $3::jsonb,
            voice_guide_md = null,
            facts = $4::jsonb
      where id = $1`,
    [
      brandId,
      JSON.stringify({ status: "pending" }),
      JSON.stringify(emptyBrandVoiceProfile()),
      JSON.stringify(facts),
    ],
  );
}
