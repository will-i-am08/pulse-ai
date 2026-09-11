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
  type VisualProfile,
} from "@pulse/shared";
import { callLLM } from "./llm.js";
import { seedPendingPlan } from "./nichePlan.js";
import { firstNameFromDisplayName, ownerFirstName } from "./persona.js";
import { connectLinkMessage, isMetaConnected } from "./smsConnect.js";
import { queueVoiceAnalysis } from "./voice/analyzeVoice.js";

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

/**
 * If facts.owner_name is missing, copy the linked user's signup name (first
 * token) onto the brand so Kip addresses them correctly without re-asking.
 */
export async function ensureOwnerNameFromUser(brand: Brand): Promise<Brand> {
  if (ownerFirstName(brand)) return brand;
  if (!brand.owner_user_id) return brand;
  const user = await queryOne<{ name: string | null }>("select name from users where id = $1", [
    brand.owner_user_id,
  ]);
  const first = firstNameFromDisplayName(user?.name);
  if (!first) return brand;
  const facts = { ...(brand.facts ?? {}), owner_name: first };
  await query("update brands set facts = $1::jsonb where id = $2", [JSON.stringify(facts), brand.id]);
  return { ...brand, facts };
}

function interviewerSystem(
  brand: Brand,
  type: AccountType,
  websiteSummary?: string,
  priorContent?: string,
): string {
  const kind = type === "personal" ? "personal social-media account" : "business";
  const knownName = ownerFirstName(brand);
  const personalBits =
    type === "personal"
      ? [
          "This is a PERSONAL account — skip ICP, ads, and offer/pricing discovery entirely.",
          "Focus on niche/vibe, tone, never-dos, and accounts they admire. Keep the niche plan light.",
          "Do not ask who their customers are, what they sell, or about promotions.",
        ]
      : [
          "Through a natural back-and-forth, learn what you need to write posts that sound exactly like them: what they do, who they're for, their tone, must-dos and never-dos, examples they love, and their emoji/hashtag style.",
        ];
  return [
    `You are Kip, "${brand.name}"'s (a ${kind}) own social media manager, getting set up. You run their socials end to end. Warm, sharp, human, like texting a switched-on mate.`,
    websiteSummary ? `From their website you already know: ${websiteSummary}` : "",
    priorContent
      ? `From their connected socials / existing posts you already know:\n${priorContent}\nTreat this as prior context. Confirm or refine — do not re-ask things you already know well.`
      : "",
    ...personalBits,
    knownName
      ? `You already know their first name is ${knownName}. Greet them by it. Do NOT ask for their name — never re-ask who they are.`
      : "Early on, warmly get their first name (by your third message at the latest) so you can address them personally from here on.",
    "Make sure you learn their niche clearly, and ask for 1-2 accounts in their space they admire (so you can study what's working before building their plan).",
    "HOW YOU TALK (absolute rules):",
    "- Your whole message contains AT MOST ONE question mark. One. If you catch yourself writing a second question, delete it and keep only the most important one. Two questions in one message is failure.",
    "- Short. Your question stays under 25 words. Most messages are 1-2 sentences.",
    "- Plain words. No jargon like POV, format, cadence, or leverage.",
    "- When they are vague, venture a concrete guess for them to react to. Never hand their fog back with a list of options.",
    "- React specifically to what they just said before you ask. Prove you listened.",
    "- Punctuate like a human texter: ... for a thoughtful pause, ! for genuine enthusiasm. Sparingly, never performative, never more than one ! per message.",
    "- No em dashes, ever. No markdown, no bold, no lists. Plain SMS text.",
    "- Never re-ask something you already know (including from the website or their existing posts).",
    "FINISH:",
    type === "personal"
      ? "- You are done when you hold: niche/vibe, tone, one never-do, content they like. Then wrap up. Do not ask about customers, ads, or offers."
      : "- You are done the moment you hold all six: niche, audience, angle, tone, one never-do, content they like. The instant you have them, wrap up. Do not ask one more question. Do not save anything for later. Extra turns actively make this worse.",
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
async function readWebsite(url: string): Promise<{ summary: string; html: string } | null> {
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
    const summary = await callLLM({
      system:
        "You extract a brand summary from website text. In 3-5 sentences, describe what the business/person does, who they serve, and the tone of their writing. Plain text only.",
      messages: [{ role: "user", content: `Website text:\n"""${text}"""\n\nSummarise the brand.` }],
      maxTokens: 300,
    });
    return { summary, html };
  } catch {
    return null;
  }
}

/** Pull logo URL + theme-color hints from raw HTML (best-effort, no network). */
export function extractVisualHintsFromHtml(html: string, baseUrl?: string): {
  logo_url?: string;
  theme_colors: string[];
} {
  const theme_colors: string[] = [];
  const theme = html.match(
    /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i,
  ) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i);
  if (theme?.[1]) theme_colors.push(theme[1].trim());

  const ms = html.match(
    /<meta[^>]+name=["']msapplication-TileColor["'][^>]+content=["']([^"']+)["']/i,
  );
  if (ms?.[1]) theme_colors.push(ms[1].trim());

  // Common logo patterns in img src / og:image as fallback.
  let logo_url: string | undefined;
  const logoImg =
    html.match(/<img[^>]+(?:class|id|alt)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/i) ??
    html.match(/<img[^>]+src=["']([^"']+)["'][^>]+(?:class|id|alt)=["'][^"']*logo[^"']*["']/i) ??
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (logoImg?.[1]) {
    const raw = logoImg[1].trim();
    if (/^https?:\/\//i.test(raw)) logo_url = raw;
    else if (baseUrl) {
      try {
        logo_url = new URL(raw, /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`).href;
      } catch {
        /* ignore bad URL */
      }
    }
  }
  return { logo_url, theme_colors };
}

/**
 * Seed brands.visual from website HTML + LLM extraction when possible.
 * Best-effort — empty visual is fine; owner can set prefs by SMS later.
 */
export async function seedVisualProfileFromWebsite(
  brand: Brand,
  html: string,
  websiteSummary?: string,
): Promise<void> {
  try {
    const hints = extractVisualHintsFromHtml(html, brand.website ?? undefined);
    const snippet = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);

    const raw = await callLLM({
      system:
        "Extract brand visual tokens from website context. Output ONLY JSON matching: " +
        '{"colors":["#hex"],"fonts":[""],"aesthetic":"","aesthetic_notes":"","photo_treatment":""}. ' +
        "Prefer 2-4 real hex colours when you can infer them. Keep fonts as family names. " +
        "photo_treatment is a short note on how their photos look (lighting, grade). " +
        "Omit fields you cannot support — never invent a fake palette from thin air.",
      messages: [
        {
          role: "user",
          content: [
            `Brand: ${brand.name}`,
            websiteSummary ? `Summary: ${websiteSummary}` : "",
            hints.theme_colors.length ? `Theme colours found: ${hints.theme_colors.join(", ")}` : "",
            hints.logo_url ? `Logo URL candidate: ${hints.logo_url}` : "",
            `Page text excerpt:\n"""${snippet}"""`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
      maxTokens: 280,
    });

    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as VisualProfile;
    const visual: VisualProfile = {
      ...(brand.visual ?? {}),
      ...(parsed.colors?.length ? { colors: parsed.colors } : {}),
      ...(parsed.fonts?.length ? { fonts: parsed.fonts } : {}),
      ...(parsed.aesthetic ? { aesthetic: parsed.aesthetic } : {}),
      ...(parsed.aesthetic_notes ? { aesthetic_notes: parsed.aesthetic_notes } : {}),
      ...(parsed.photo_treatment ? { photo_treatment: parsed.photo_treatment } : {}),
      ...(hints.logo_url ? { logo_url: hints.logo_url } : {}),
      ...(hints.theme_colors.length && !parsed.colors?.length
        ? { colors: hints.theme_colors }
        : {}),
    };
    if (!Object.keys(visual).length) return;
    await query(`update brands set visual = $1::jsonb where id = $2`, [
      JSON.stringify(visual),
      brand.id,
    ]);
  } catch {
    /* best-effort */
  }
}

/** Begin onboarding: read the website if present, then open the conversation (LLM-generated). */
/** Keep prior voice/content context short enough for the interview prompt. */
function priorContentForInterview(brand: Brand, answers: Record<string, string>): string | undefined {
  const guide = (brand.voice_guide_md ?? "").trim();
  if (guide) return guide.length > 1800 ? `${guide.slice(0, 1800)}…` : guide;
  const fromAnswers = (answers.voice_summary ?? answers.content_summary ?? "").trim();
  return fromAnswers || undefined;
}

const SKIP_CONNECT_RE =
  /^\s*(skip|later|not now|no thanks|don't have|dont have|no ig|no instagram|no facebook|none|n\/a)\b/i;

export function looksLikeSkipConnect(body: string): boolean {
  return SKIP_CONNECT_RE.test(body.trim());
}

/**
 * Open the SMS interview (after connect/skip). Uses website + harvested voice
 * as prior context so Kip does not re-ask what it already learned.
 */
export async function beginOnboardingInterview(brandId: string): Promise<string> {
  let brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`beginOnboardingInterview: brand ${brandId} not found`);
  brand = await ensureOwnerNameFromUser(brand);

  const prev = brand.onboarding_state ?? { status: "none" };
  if (prev.status === "done" || typeof prev.completed_at === "string") {
    const name = ownerFirstName(brand);
    return name
      ? `Hey ${name} — we're already set up. Send a photo or tell me what you want to post.`
      : "Hey — we're already set up. Send a photo or tell me what you want to post.";
  }

  const type: AccountType = prev.type ?? brand.account_type ?? "business";
  const answers: Record<string, string> = { ...(prev.answers ?? {}) };
  const websiteSummary = answers.website_summary;
  const prior = priorContentForInterview(brand, answers);

  const knownName = ownerFirstName(brand);
  const system = interviewerSystem(brand, type, websiteSummary, prior);
  const reflectPrior = prior
    ? " You already studied their existing posts — briefly reflect one concrete thing you noticed, then ask your first most useful question that fills a gap."
    : websiteSummary
      ? " If you learned things from their website, briefly reflect that back before asking your first, most useful question."
      : " Ask your first, most useful question.";
  const seed: OnboardingTurnMsg = {
    role: "user",
    content: knownName
      ? `Start the onboarding interview now: greet them as ${knownName} (you already know their name — do not ask for it).${reflectPrior}`
      : `Start the onboarding interview now: greet them by name.${reflectPrior}`,
  };
  const opening = await callLLM({ system, messages: toMessages([seed]), maxTokens: 250 });
  const transcript: OnboardingTurnMsg[] = [seed, { role: "assistant", content: opening }];
  await saveState(brand.id, { status: "in_progress", type, turns: 0, transcript, answers });
  return sanitizeChatText(await enforceOneQuestion(opening));
}

/** After Meta connect during onboarding: queue harvest and park on reading_content. */
export async function onChannelsConnectedDuringOnboarding(
  brandId: string,
): Promise<{ handled: boolean; message?: string }> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) return { handled: false };
  const status = brand.onboarding_state?.status;
  if (status !== "awaiting_connect" && status !== "pending" && status !== "reading_content") {
    return { handled: false };
  }
  const prev = brand.onboarding_state ?? { status: "awaiting_connect" as const };
  const type: AccountType = prev.type ?? brand.account_type ?? "business";
  const answers: Record<string, string> = { ...(prev.answers ?? {}), connected_meta: "1" };
  delete answers.skipped_connect;
  delete answers.skipped_connect_at;
  delete answers.connect_nudge_count;
  delete answers.connect_nudge_at;
  await saveState(brand.id, {
    status: "reading_content",
    type,
    turns: prev.turns ?? 0,
    transcript: prev.transcript ?? [],
    answers,
  });
  await queueVoiceAnalysis(brand.id).catch(() => undefined);
  const ig = brand.ig_username ? `@${brand.ig_username}` : "Instagram";
  return {
    handled: true,
    message: `Connected ✅ ${ig}. I'm reading your existing posts now so I don't ask stuff you already show online — one sec.`,
  };
}

/**
 * After voice analysis finishes (or skips/fails): start the interview if we were
 * waiting on reading_content. Returns the opening SMS, or null if not applicable.
 */
export async function continueOnboardingAfterVoiceAnalysis(brandId: string): Promise<string | null> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) return null;
  if (brand.onboarding_state?.status !== "reading_content") return null;
  return beginOnboardingInterview(brandId);
}

/** Handle inbound SMS while waiting for channel connect (or skip). */
export async function handleAwaitingConnect(brand: Brand, body: string): Promise<string> {
  const text = (body ?? "").trim();
  if (looksLikeSkipConnect(text)) {
    const prev = brand.onboarding_state ?? { status: "awaiting_connect" as const };
    const type: AccountType = prev.type ?? brand.account_type ?? "business";
    const answers: Record<string, string> = { ...(prev.answers ?? {}), skipped_connect: "1", skipped_connect_at: new Date().toISOString(), connect_nudge_count: "0" };
    await saveState(brand.id, {
      status: "in_progress",
      type,
      turns: 0,
      transcript: prev.transcript ?? [],
      answers,
    });
    // beginOnboardingInterview sets in_progress + opening
    return beginOnboardingInterview(brand.id);
  }
  if (isMetaConnected(brand)) {
    const result = await onChannelsConnectedDuringOnboarding(brand.id);
    return result.message ?? "Connected — reading your posts now.";
  }
  const link = connectLinkMessage(brand, "meta");
  return `All good — tap the link to connect Instagram + Facebook first (so I can learn from what you already post), or reply "skip" if you don't have them yet.\n\n${link}`;
}

/** Hold-line while voice harvest runs. */
export async function handleReadingContent(_brand: Brand, _body: string): Promise<string> {
  return "Still reading your posts, nearly there — then I'll ask a couple of quick questions.";
}

/**
 * Begin onboarding after payment is submitted.
 * Reads website if present, then asks them to connect channels first so Kip can
 * harvest existing content before the interview.
 */
export async function startOnboarding(brandId: string): Promise<string> {
  let brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`startOnboarding: brand ${brandId} not found`);
  brand = await ensureOwnerNameFromUser(brand);

  const prev = brand.onboarding_state ?? { status: "none" };
  // Never re-run setup once it has completed — even if status was parked as none.
  if (prev.status === "done" || typeof prev.completed_at === "string") {
    const name = ownerFirstName(brand);
    return name
      ? `Hey ${name} — we're already set up. Send a photo or tell me what you want to post.`
      : "Hey — we're already set up. Send a photo or tell me what you want to post.";
  }

  // Already mid-flow — don't restart from connect.
  if (prev.status === "in_progress") {
    return "We're mid set-up — just reply to the last question and I'll keep going.";
  }
  if (prev.status === "reading_content") {
    return handleReadingContent(brand, "");
  }
  if (prev.status === "wrapping_up") {
    return "Still writing your voice up, nearly there.";
  }

  const type: AccountType = brand.account_type ?? "business";

  let websiteSummary: string | undefined;
  let websiteHtml: string | undefined;
  if (brand.website) {
    const read = await readWebsite(brand.website);
    if (read) {
      websiteSummary = read.summary;
      websiteHtml = read.html;
      // Seed visual tokens early so quote cards / tiles can use brand colours ASAP.
      await seedVisualProfileFromWebsite(brand, websiteHtml, websiteSummary);
    }
  }

  const answers: Record<string, string> = websiteSummary ? { website_summary: websiteSummary } : {};
  const knownName = ownerFirstName(brand);
  const hello = knownName ? `Hey ${knownName}` : "Hey";

  // Already connected (e.g. dashboard) — harvest first, then interview.
  if (isMetaConnected(brand)) {
    await saveState(brand.id, { status: "reading_content", type, turns: 0, transcript: [], answers });
    await queueVoiceAnalysis(brand.id).catch(() => undefined);
    const ig = brand.ig_username ? `@${brand.ig_username}` : "your Instagram";
    return `${hello}, it's Kip — thanks for being here. I'm reading ${ig} now so I can learn your voice from what you already post. Hang tight.`;
  }

  await saveState(brand.id, { status: "awaiting_connect", type, turns: 0, transcript: [], answers });
  const link = connectLinkMessage(brand, "meta");
  return (
    `${hello}, it's Kip — thanks for jumping in. First up, connect Instagram + Facebook so I can learn from what you already post before we chat.`
    + ` If you don't have them yet, reply "skip".\n\n${link}`
  );
}

/**
 * Payment-submitted kickoff. Call from the billing webhook / checkout success
 * handler as soon as payment clears — not at signup.
 * Returns the first SMS body for the gateway/worker to deliver.
 */
export async function kickOffOnboardingAfterPayment(brandId: string): Promise<string> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`kickOffOnboardingAfterPayment: brand ${brandId} not found`);
  const status = brand.onboarding_state?.status ?? "none";
  if (status === "done" || typeof brand.onboarding_state?.completed_at === "string") {
    return startOnboarding(brandId);
  }
  if (status === "none" || status === "pending") {
    await saveState(brandId, {
      status: "pending",
      type: brand.account_type ?? "business",
      turns: 0,
      transcript: [],
      answers: brand.onboarding_state?.answers ?? {},
    });
  }
  return startOnboarding(brandId);
}

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

  const prior = priorContentForInterview(brand, answers);
  const system = interviewerSystem(brand, type, answers.website_summary, prior);
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
  await saveState(brand.id, {
    status: "done",
    completed_at: new Date().toISOString(),
    type,
    turns,
    transcript,
    answers,
  });
  await captureOwnerName(brand, transcript);
  const latest = (await queryOne<Brand>("select * from brands where id = $1", [brand.id])) ?? brand;
  await ensureOwnerNameFromUser(latest);
  await captureNicheAndSeedPlan(brand, transcript);
  // Cold-start design: seed niche exemplar URLs so first compose isn't empty-handed.
  try {
    const { seedOnboardingNicheExemplars } = await import("./designBootstrap.js");
    await seedOnboardingNicheExemplars(brand.id);
  } catch {
    /* table may not exist yet */
  }
  const planLine =
    type === "personal"
      ? `One more thing: I'm putting together a light niche plan for you. I'll send it over in a couple of minutes 👀`
      : `One more thing: I'm studying your space to build you a tailored content plan. I'll send it over in a couple of minutes 👀`;
  return `${signoff}\n\n${recap}\n\n${nextStepFor(type, transcript)}\n\n${planLine}`;
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

  // Merge with anything voice analysis already learned — union, don't clobber.
  const existing = brandVoiceProfileSchema.parse(brand.brand_voice_profile ?? {});
  const merged = brandVoiceProfileSchema.parse({
    tone: [...new Set([...(existing.tone ?? []), ...(profile.tone ?? [])])].slice(0, 8),
    dos: [...new Set([...(existing.dos ?? []), ...(profile.dos ?? [])])].slice(0, 12),
    donts: [...new Set([...(existing.donts ?? []), ...(profile.donts ?? [])])].slice(0, 12),
    example_captions: [...new Set([...(existing.example_captions ?? []), ...(profile.example_captions ?? [])])].slice(0, 8),
    banned_words: [...new Set([...(existing.banned_words ?? []), ...(profile.banned_words ?? [])])],
    emoji_policy: profile.emoji_policy || existing.emoji_policy,
    hashtag_policy: profile.hashtag_policy || existing.hashtag_policy,
    notes: existing.notes ?? [],
    writing_mechanics: existing.writing_mechanics ?? profile.writing_mechanics,
    photo_style: existing.photo_style ?? profile.photo_style,
    analysis_source: existing.analysis_source || profile.analysis_source || "",
  });
  profile = merged;

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
  // Intentional wipe of completed_at — lab "new chat" / redo setup starts clean.
  await query(
    `update brands set onboarding_state = $2::jsonb where id = $1`,
    [brandId, JSON.stringify({ status: "pending" })],
  );
  return startOnboarding(brandId);
}

export type LabChatSummary = {
  id: string;
  title: string;
  status: "active" | "archived";
  started_at: string;
  archived_at: string | null;
  message_count: number;
};

/**
 * Archive the current lab SMS thread (so it stays browsable), wipe live
 * messages so Kip has no memory of them, then soft-restart onboarding.
 * Does NOT create a new brand — same lab brand, new chat.
 */
export async function archiveLabChatAndRestart(brandId: string): Promise<{
  greeting: string;
  archivedChatId: string | null;
}> {
  const brand = await queryOne<Brand>("select * from brands where id = $1", [brandId]);
  if (!brand) throw new Error(`archiveLabChatAndRestart: brand ${brandId} not found`);
  if (!brand.facts?.lab) {
    throw new Error(`archiveLabChatAndRestart: brand ${brandId} is not a lab brand (facts.lab)`);
  }

  const countRow = await queryOne<{ count: string }>(
    `select count(*)::text as count from messages where brand_id = $1`,
    [brandId],
  );
  const messageCount = Number(countRow?.count ?? 0);
  let archivedChatId: string | null = null;

  if (messageCount > 0) {
    const started = await queryOne<{ min: string | null }>(
      `select min(created_at)::text as min from messages where brand_id = $1`,
      [brandId],
    );
    const startedAt = started?.min ? new Date(started.min) : new Date();
    const title = `Chat · ${startedAt.toLocaleString("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
    })}`;

    const chat = await queryOne<{ id: string }>(
      `insert into lab_chats (brand_id, title, status, started_at, archived_at, message_count)
       values ($1, $2, 'archived', $3, now(), $4)
       returning id`,
      [brandId, title, startedAt.toISOString(), messageCount],
    );
    if (!chat) throw new Error("archiveLabChatAndRestart: failed to create lab_chats row");
    archivedChatId = chat.id;

    await query(
      `insert into lab_chat_messages (
         id, chat_id, brand_id, direction, channel, body, media_ids, type, provider_message_sid, created_at
       )
       select id, $2, brand_id, direction, channel, body, media_ids, type, provider_message_sid, created_at
         from messages
        where brand_id = $1`,
      [brandId, chat.id],
    );

    await query(
      `update lab_notes set lab_chat_id = $2
        where brand_id = $1 and lab_chat_id is null`,
      [brandId, chat.id],
    );

    // Wipe live thread so conversation context / memory is empty for the new chat.
    await query(`delete from messages where brand_id = $1`, [brandId]);
  }

  const greeting = await restartOnboarding(brandId);
  return { greeting, archivedChatId };
}

export async function listLabChats(brandId: string): Promise<LabChatSummary[]> {
  return query<LabChatSummary>(
    `select id, title, status, started_at::text, archived_at::text, message_count
       from lab_chats
      where brand_id = $1
      order by coalesce(archived_at, started_at) desc`,
    [brandId],
  );
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
  await query(`delete from lab_chat_messages where brand_id = $1`, [brandId]);
  await query(`delete from lab_chats where brand_id = $1`, [brandId]);
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
            facts = $4::jsonb,
            visual = '{}'::jsonb,
            icp = '{}'::jsonb,
            pain_points = '{}'::jsonb,
            positioning = '{}'::jsonb,
            offers = '{}'::jsonb,
            contact_card_sent_at = null
      where id = $1`,
    [
      brandId,
      JSON.stringify({ status: "pending" }),
      JSON.stringify(emptyBrandVoiceProfile()),
      JSON.stringify(facts),
    ],
  );
  await query(`delete from design_memory where brand_id = $1`, [brandId]);
}
