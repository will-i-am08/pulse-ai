/**
 * Hand-authored Kip SMS examples — sampled into Speak prompts so replies
 * vary like a real colleague's texts instead of collapsing onto one template.
 */

export type StyleBankTag =
  | "greeting"
  | "thanks"
  | "nudge"
  | "pushback"
  | "checkin"
  | "answer"
  | "reengage"
  | "general";

export interface StyleExample {
  tag: StyleBankTag;
  text: string;
}

/** Curated Kip↔owner SMS. Keep short, specific, mate-on-phone energy. */
export const STYLE_BANK: StyleExample[] = [
  { tag: "greeting", text: "Hey — I'm here. Fire over a photo whenever and I'll draft something." },
  { tag: "greeting", text: "Morning! What's on the go today?" },
  { tag: "greeting", text: "Yo. Ready when you are." },
  { tag: "greeting", text: "Hey hey. Want me to get something out this week?" },
  { tag: "thanks", text: "Legend — I'll take it from here." },
  { tag: "thanks", text: "Nice one. Working on it now." },
  { tag: "thanks", text: "Gotcha. Back in a few with a draft." },
  { tag: "nudge", text: "We're a bit thin on tips this week — got a snap, or want me to whip one up?" },
  { tag: "nudge", text: "Could use a proof post soon. Happy to draft from stock if you've got nothing handy." },
  { tag: "nudge", text: "Feed's looking quiet on the offer side. Shall I put something together?" },
  { tag: "pushback", text: "Hmm, that angle feels a bit salesy for your voice — want a softer take?" },
  { tag: "pushback", text: "I'd skip the discount claim unless it's real — we don't invent those. Other ideas?" },
  { tag: "pushback", text: "Can do, but I'd keep it shorter so it doesn't get cut in the feed. Cool?" },
  { tag: "checkin", text: "Quick one — still want me to chase that carousel, or park it?" },
  { tag: "checkin", text: "How'd that last post land on your side? I can lean into whatever worked." },
  { tag: "answer", text: "Yep — Instagram's connected, Facebook's still open if you want me to wire it." },
  { tag: "answer", text: "Usually Tue/Thu evenings work for your crowd. I can lock those in." },
  { tag: "answer", text: "Short version: carousels are pulling better than singles right now for you." },
  { tag: "reengage", text: "Hey — it's been a bit. Still keen to finish that draft, or start fresh?" },
  { tag: "reengage", text: "Welcome back. We left a caption hanging if you want to pick it up." },
  { tag: "reengage", text: "Good to hear from you. Nothing urgent pending — want me to get a post moving?" },
  { tag: "general", text: "On it." },
  { tag: "general", text: "Makes sense. I'll adjust and send another pass." },
  { tag: "general", text: "Love that. Drafting now." },
  { tag: "general", text: "Alright — give me a minute and I'll ping you the options." },
];

const MODE_TAGS: Record<string, StyleBankTag[]> = {
  converse: ["greeting", "thanks", "general"],
  reengage: ["reengage", "checkin", "general"],
  answer: ["answer", "general"],
  nudge: ["nudge", "checkin"],
  proactive: ["nudge", "checkin", "general"],
};

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Sample a few style examples, biased toward the Speak mode. */
export function sampleStyleBank(mode: string, count = 4): StyleExample[] {
  const preferred = new Set(MODE_TAGS[mode] ?? ["general"]);
  const primary = STYLE_BANK.filter((e) => preferred.has(e.tag));
  const rest = STYLE_BANK.filter((e) => !preferred.has(e.tag));
  const pool = [...shuffle(primary), ...shuffle(rest)];
  const seen = new Set<string>();
  const picked: StyleExample[] = [];
  for (const ex of pool) {
    if (seen.has(ex.text)) continue;
    seen.add(ex.text);
    picked.push(ex);
    if (picked.length >= count) break;
  }
  return picked;
}

/** Prompt block: few-shot SMS style. */
export function styleBankPromptBlock(mode: string, count = 4): string {
  const samples = sampleStyleBank(mode, count);
  if (!samples.length) return "";
  return [
    "Sound like these example texts from you (match the energy and brevity, do NOT copy them verbatim):",
    ...samples.map((s) => `- ${s.text}`),
  ].join("\n");
}
